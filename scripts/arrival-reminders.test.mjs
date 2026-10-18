// Round 60a Phase 2 — arrival + filing reminder renderers
// (api/send-arrival-reminders.js).
//
// Verifies the Garante-compliance invariant: the FILING reminder email
// is count-only — no guest names, document numbers, or dates of birth
// anywhere in the body. The ARRIVAL reminder email does include the
// guest name (the host's own email about their own guests), but each
// row MUST have a per-guest booking link, platform label and a
// localised "share message" CTA.
//
// Also exercises _hostLang language fallback and the simple HTML
// escaping used across both renderers.
//
// Pure — no network, no DB. Extracts helpers from the source via
// text slicing (same pattern as onboarding-test-isolation.test.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const src = fs.readFileSync(new URL('../api/send-arrival-reminders.js', import.meta.url), 'utf8');
function slice(name) {
  const key = 'function ' + name + '(';
  const start = src.indexOf(key);
  assert.ok(start >= 0, 'cannot find ' + name);
  let end = src.indexOf('\n}', start);
  while (end >= 0) {
    const candidate = src.slice(start, end + 2);
    try { new vm.Script(candidate); return candidate; } catch { /* keep scanning */ }
    end = src.indexOf('\n}', end + 2);
  }
  throw new Error('cannot extract ' + name);
}

const ctx = vm.createContext({
  console,
  APP_BASE_URL: 'https://app.welcomebnb.it',
  HOST_CONSOLE_URL: 'https://app.welcomebnb.it/host-console.html',
});
for (const n of ['esc', '_hostLang', 'renderArrivalHTML', 'renderFilingHTML']) {
  vm.runInContext(slice(n), ctx);
}

// ── _hostLang: defaults to it, respects 'en', ignores garbage ──────
assert.equal(ctx._hostLang({}), 'it', 'default host_language → it');
assert.equal(ctx._hostLang({ host_language: 'en' }), 'en');
assert.equal(ctx._hostLang({ host_language: 'de' }), 'it', 'unknown language falls back to it');
assert.equal(ctx._hostLang(null), 'it');

// ── esc: HTML escaping ────────────────────────────────────────────
assert.equal(ctx.esc('<script>alert(1)</script>'),
  '&lt;script&gt;alert(1)&lt;/script&gt;');
assert.equal(ctx.esc('Mario & "friends"'),
  'Mario &amp; &quot;friends&quot;');
assert.equal(ctx.esc(null), '');
assert.equal(ctx.esc(undefined), '');

// ── renderArrivalHTML: IT ─────────────────────────────────────────
{
  const property = { id: 'prop-1', name: 'Trullo di Prova', host_language: 'it' };
  const rows = [
    { platform: 'airbnb', guest_name: 'Mario Rossi', checkin_date: '2026-07-10', checkout_date: '2026-07-13', booking_code: 'ABC-123' },
    { platform: 'booking', guest_name: null, checkin_date: '2026-07-10', checkout_date: '2026-07-15', booking_code: 'XYZ-999' },
    { platform: 'direct', guest_name: 'Senza <script>Codice</script>', checkin_date: '2026-07-10', checkout_date: '2026-07-11', booking_code: null },
  ];
  const html = ctx.renderArrivalHTML(property, rows, 'it');
  // Header carries property name.
  assert.match(html, /Arrivi domani presso Trullo di Prova/);
  // Booking link uses encoded parameters, points at APP_BASE_URL.
  assert.match(html, /https:\/\/app\.welcomebnb\.it\/\?b=ABC-123&amp;p=prop-1/);
  assert.match(html, /https:\/\/app\.welcomebnb\.it\/\?b=XYZ-999&amp;p=prop-1/);
  // Direct → Diretta label; booking → Booking.com; airbnb → Airbnb.
  assert.match(html, /Airbnb/);
  assert.match(html, /Booking\.com/);
  assert.match(html, /Diretta/);
  // Row 3 has no booking_code: must NOT render a link; must render the
  // IT no-code placeholder.
  assert.match(html, /Nessun codice prenotazione ancora/);
  // Script injection in guest name is escaped.
  assert.match(html, /Senza &lt;script&gt;Codice&lt;\/script&gt;/);
  assert.ok(!html.includes('<script>Codice</script>'),
    'raw script tag must never appear in rendered HTML');
  // Row 2 has no guest_name → generic placeholder "Ospite".
  assert.match(html, /Ospite · 2026-07-10 → 2026-07-15/);
  // "Prepare message" CTA (IT variant).
  assert.match(html, /Prepara messaggio/);
}

// ── renderArrivalHTML: EN ─────────────────────────────────────────
{
  const property = { id: 'p2', name: 'Casa Blu', host_language: 'en' };
  const rows = [
    { platform: 'vrbo', guest_name: 'Anna Schmidt', checkin_date: '2026-08-01', checkout_date: '2026-08-05', booking_code: 'VR-1' },
  ];
  const html = ctx.renderArrivalHTML(property, rows, 'en');
  assert.match(html, /Arriving tomorrow at Casa Blu/);
  assert.match(html, /Anna Schmidt/);
  assert.match(html, /Vrbo/);
  assert.match(html, /Prepare message/);
  assert.ok(!html.includes('Prepara messaggio'), 'IT label must not leak into EN email');
}

// ── Fallback property name when `name` is missing ──────────────────
{
  const html = ctx.renderArrivalHTML({ id: 'p3' }, [], 'it');
  assert.match(html, /Arrivi domani presso la tua struttura/);
}

// ── renderFilingHTML: COUNT-ONLY (Garante compliance) ─────────────
const FORBIDDEN_IN_FILING = [
  'Mario', 'Rossi', 'passport', 'passaporto',
  'FACSIMILE', '1980', 'birth', 'nascita',
  'document', 'documento',
];
{
  const property = { id: 'p', name: 'Trullo', host_language: 'it' };
  // Pass arbitrary guest-looking data to prove the renderer ignores it —
  // it takes a count, not the rows.
  const html = ctx.renderFilingHTML(property, '2026-10-14', 3, 'it');
  assert.match(html, /Promemoria invio Alloggiati — Trullo/);
  assert.match(html, /<strong>3<\/strong>/, 'count rendered as bold number');
  assert.match(html, /TULPS art\. 109/);
  assert.match(html, /2026-10-14/, 'date present');
  for (const forbidden of FORBIDDEN_IN_FILING) {
    assert.ok(!html.toLowerCase().includes(forbidden.toLowerCase()),
      `filing email must never contain "${forbidden}" — found in: ${html.slice(0, 400)}`);
  }
}
{
  const html = ctx.renderFilingHTML({ id: 'p', name: 'Casa', host_language: 'en' }, '2026-10-14', 1, 'en');
  assert.match(html, /<strong>1<\/strong> guest checked in yesterday/);
  assert.match(html, /Filing reminder — Casa/);
  // Plural/singular switches on count=1 (English).
  assert.doesNotMatch(html, /guests checked in yesterday/, 'count 1 → "guest" singular');
}
{
  // Plural branch
  const html = ctx.renderFilingHTML({ id: 'p', name: 'Casa', host_language: 'en' }, '2026-10-14', 7, 'en');
  assert.match(html, /<strong>7<\/strong> guests checked in yesterday/);
  assert.match(html, /have not been marked/);
  assert.match(html, /each of them/, 'plural → "each of them"');
}

// ── Language dedup: IT subject does not leak into EN HTML ─────────
{
  const html = ctx.renderFilingHTML({ id: 'p', name: 'Casa', host_language: 'en' }, '2026-10-14', 2, 'en');
  assert.ok(!html.includes('Promemoria invio'), 'IT heading must not appear in EN email');
  assert.ok(!html.includes('ospit'), 'IT body must not appear in EN email');
}

console.log('PASS arrival-reminders: _hostLang fallback, esc, arrival IT/EN rendering (guest links, platform labels, no-code placeholder, XSS escape), filing count-only (no PII), singular/plural, language isolation.');
