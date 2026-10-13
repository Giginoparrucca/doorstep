// Round 50 Phase 3 — fictional showcase fixtures for the demo project.
// Pure data + a date-materializer so unit tests, the seeder and the reset
// procedure share the same canonical scenario list.
//
// Nothing in this file is real. Every email uses @example.com /
// @example.org (RFC 2606 reserved), every phone is null (demo bookings
// contain no reachable contact) or a visibly-fictional +39 000 … number,
// and every passport/document number is a FACSIMILE pattern.
//
// Stable IDs: UUID v4 shaped like 50505050-0000-4000-8000-NNNNNNNNNNNN
// (version 4 nibble, RFC-4122 variant). The low 12 bits encode the
// fixture slot so the manifest is diff-friendly.

// Round 51 host-initiated tests are transient direct bookings, separate
// from the stable Round 50 showcase scenarios. Never purge the scenarios
// through onboarding cleanup; only raw.onboarding_test=true qualifies.
export const ONBOARDING_TEST_MARKER = Object.freeze({ onboarding_test: true });

export const DEMO_PROJECT_REF = 'wmegnnlmcrabndyzywmj';

// Presenter accounts (provisioned by scripts/demo-auth-storage-gate.mjs).
// Owner IDs below are the actual Auth user IDs created in that run.
export const PRESENTERS = Object.freeze([
  Object.freeze({
    email: 'presenter.daniele@example.com',
    userId: 'edcf2a10-a59b-4565-8721-7dafd7567417',
    name: 'Daniele — Demo presenter',
  }),
  Object.freeze({
    email: 'presenter.probe@example.com',
    userId: 'fec66ee7-518c-4440-b663-003eee505839',
    name: 'Demo isolation probe',
  }),
]);

// Primary property (presenter 1). Keeps the stable ID the hosted
// Auth/ownership gate (scripts/demo-auth-storage-gate.mjs) uses.
export const PROPERTY_PRIMARY = Object.freeze({
  id: '50505050-0000-4000-8000-000000000003',
  ownerId: PRESENTERS[0].userId,
  name: 'Casa Demo WelcomeBnB',
  property_type: 'Trullo',
  address: 'Contrada FACSIMILE 1',
  city: 'Ostuni',
  zip: '72017',
  region: 'Puglia',
  country: 'Italy',
  checkin_time: '15:00:00',
  checkout_time: '10:00:00',
  access_method: 'Self check-in · Keybox',
  keybox_code: '0714',
  wifi_name: 'CasaDemo-WelcomeBnB',
  wifi_password: 'ospite-demo-2026',
  host_names: 'Daniele',
  host_phone: null,
  host_email: 'presenter.daniele@example.com',
  welcome_message_it: 'Benvenuto a Casa Demo WelcomeBnB! Questa è una demo con dati fittizi.',
  welcome_message_en: 'Welcome to Casa Demo WelcomeBnB! This is a demo with fictional data.',
  checkin_instructions_it: 'Esempio di istruzioni di check-in. Codice keybox nel messaggio di benvenuto.',
  checkin_instructions_en: 'Example check-in instructions. Keybox code shown in the welcome message.',
  checkout_instructions_it: 'Esempio: chiudere la finestra, riporre le chiavi nel keybox entro le 10:00.',
  checkout_instructions_en: 'Example: close the window, return keys to the keybox by 10:00.',
  transport_info_it: 'Stazione di Ostuni a 2 km. Aeroporto di Brindisi a 35 km.',
  transport_info_en: 'Ostuni train station 2 km. Brindisi airport 35 km.',
  tax_rate_eur: 1.50,
  tax_max_nights: 5,
  tax_max_nights_basis: 'per_stay',
  tax_exempt_under_age: 14,
  tax_source_note: 'Illustrative demo value — not the real Ostuni rate',
  alloggiati_autofile_mode: 'off',
  rooms_available: 2,
  beds_available: 4,
  is_test: true,
  timezone: 'Europe/Rome',
  host_language: 'it',
});

// Second property, owned by presenter 2 — used for property-switching
// and cross-owner isolation demonstrations.
export const PROPERTY_SECONDARY = Object.freeze({
  id: '50505050-0000-4000-8000-000000000002',
  ownerId: PRESENTERS[1].userId,
  name: 'Trullo Fico Vicino',
  property_type: 'Trullo',
  address: 'Via FACSIMILE 2',
  city: 'Cisternino',
  zip: '72014',
  region: 'Puglia',
  country: 'Italy',
  checkin_time: '16:00:00',
  checkout_time: '11:00:00',
  access_method: 'Self check-in · Keybox',
  keybox_code: '1980',
  wifi_name: 'TrulloFico-Demo',
  wifi_password: 'demo-cisternino-2026',
  host_names: 'Demo isolation probe',
  host_phone: null,
  host_email: 'presenter.probe@example.com',
  welcome_message_it: 'Benvenuto al Trullo Fico Vicino (demo).',
  welcome_message_en: 'Welcome to Trullo Fico Vicino (demo).',
  // Explicit zero exercises the no-tax onboarding path; fictional, not municipal law.
  tax_rate_eur: 0,
  tax_source_note: 'FACSIMILE — zero-rate onboarding example, not a municipal rule.',
  tax_max_nights: 3,
  tax_max_nights_basis: 'per_stay',
  alloggiati_autofile_mode: 'off',
  rooms_available: 1,
  beds_available: 2,
  is_test: true,
  timezone: 'Europe/Rome',
  host_language: 'it',
});

export const PROPERTIES = Object.freeze([PROPERTY_PRIMARY, PROPERTY_SECONDARY]);

// Six real places around the declared demo location (Ostuni, Puglia).
// Verified by name + address on Google Maps 2026-10-11. We do NOT seed
// hours, reviews or walking times — those remain live where available.
export const RECOMMENDATIONS = Object.freeze([
  Object.freeze({
    id: '50505050-0000-4000-8000-000000000101',
    property_id: PROPERTY_PRIMARY.id,
    category: 'landmark',
    name: 'Concattedrale di Santa Maria Assunta',
    address: 'Piazza della Cattedrale, 72017 Ostuni BR',
    image_url: null,
    sort_order: 10,
    desc_it: 'Cattedrale tardogotica del centro storico (fonte: Google Maps).',
    desc_en: 'Late-Gothic cathedral in the historic centre (source: Google Maps).',
    tags: 'historic,walking',
    is_test: true,
  }),
  Object.freeze({
    id: '50505050-0000-4000-8000-000000000102',
    property_id: PROPERTY_PRIMARY.id,
    category: 'food',
    name: 'Osteria del Tempo Perso',
    address: 'Via Gaetano Tanzarella Vitale, 47, 72017 Ostuni BR',
    image_url: null,
    sort_order: 20,
    desc_it: 'Ristorante nel centro storico (fonte: Google Maps).',
    desc_en: 'Restaurant in the historic centre (source: Google Maps).',
    tags: 'dinner,local',
    is_test: true,
  }),
  Object.freeze({
    id: '50505050-0000-4000-8000-000000000103',
    property_id: PROPERTY_PRIMARY.id,
    category: 'beach',
    name: 'Spiaggia di Costa Merlata',
    address: 'Costa Merlata, 72017 Ostuni BR',
    image_url: null,
    sort_order: 30,
    desc_it: 'Spiaggia pubblica sulla costa adriatica (fonte: Google Maps).',
    desc_en: 'Public beach on the Adriatic coast (source: Google Maps).',
    tags: 'beach,sea',
    is_test: true,
  }),
  Object.freeze({
    id: '50505050-0000-4000-8000-000000000104',
    property_id: PROPERTY_PRIMARY.id,
    category: 'nature',
    name: 'Riserva Naturale di Torre Guaceto',
    address: 'SP21, 72012 Carovigno BR',
    image_url: null,
    sort_order: 40,
    desc_it: 'Riserva marina protetta (fonte: Google Maps).',
    desc_en: 'Protected marine reserve (source: Google Maps).',
    tags: 'nature,hiking',
    is_test: true,
  }),
  Object.freeze({
    id: '50505050-0000-4000-8000-000000000105',
    property_id: PROPERTY_PRIMARY.id,
    category: 'food',
    name: 'Masseria Il Frantoio',
    address: 'SS16 km 874, 72017 Ostuni BR',
    image_url: null,
    sort_order: 50,
    desc_it: 'Masseria storica con uliveto (fonte: Google Maps).',
    desc_en: 'Historic masseria with olive grove (source: Google Maps).',
    tags: 'dinner,historic',
    is_test: true,
  }),
  Object.freeze({
    id: '50505050-0000-4000-8000-000000000106',
    property_id: PROPERTY_PRIMARY.id,
    category: 'landmark',
    name: 'Chiesa dello Spirito Santo',
    address: 'Via Cattedrale, 72017 Ostuni BR',
    image_url: null,
    sort_order: 60,
    desc_it: 'Chiesa del centro storico (fonte: Google Maps).',
    desc_en: 'Historic-centre church (source: Google Maps).',
    tags: 'historic,walking',
    is_test: true,
  }),
]);

export const RULES = Object.freeze([
  Object.freeze({
    id: '50505050-0000-4000-8000-000000000201',
    property_id: PROPERTY_PRIMARY.id,
    icon: '🚭',
    title_it: 'Vietato fumare',
    title_en: 'No smoking',
    desc_it: 'Esempio di regola.',
    desc_en: 'Example rule.',
    is_important: true,
    sort_order: 10,
  }),
  Object.freeze({
    id: '50505050-0000-4000-8000-000000000202',
    property_id: PROPERTY_PRIMARY.id,
    icon: '🐾',
    title_it: 'Animali su richiesta',
    title_en: 'Pets on request',
    desc_it: 'Esempio di regola.',
    desc_en: 'Example rule.',
    is_important: false,
    sort_order: 20,
  }),
]);

// Booking scenarios. Each entry carries its own stable UUID. The dates
// are expressed as integer offsets from the chosen reset day in
// Europe/Rome; the seeder materializes them via buildManifest(todayISO).
export const BOOKING_SCENARIOS = Object.freeze([
  // DEMO-ARRIVO — arrival tomorrow, no check-in yet.
  Object.freeze({
    code: 'DEMO-ARRIVO',
    ota_id: '50505050-0000-4000-8000-000000000301',
    property_id: PROPERTY_PRIMARY.id,
    arrival_offset: 1, departure_offset: 3,
    guest_name: 'Rossi — ESEMPIO',
    guest_count: 2,
    with_checkin: false,
    demonstration: 'Reservation and shareable guest link',
  }),
  // DEMO-NUOVO — arrival today, no check-in yet; drives the full guest flow.
  Object.freeze({
    code: 'DEMO-NUOVO',
    ota_id: '50505050-0000-4000-8000-000000000302',
    property_id: PROPERTY_PRIMARY.id,
    arrival_offset: 0, departure_offset: 2,
    guest_name: 'Bianchi — ESEMPIO',
    guest_count: 1,
    with_checkin: false,
    demonstration: 'Complete interactive guest journey',
  }),
  // DEMO-SOGGIORNO — mid-stay.
  Object.freeze({
    code: 'DEMO-SOGGIORNO',
    ota_id: '50505050-0000-4000-8000-000000000303',
    property_id: PROPERTY_PRIMARY.id,
    arrival_offset: -1, departure_offset: 3,
    guest_name: 'Verdi — ESEMPIO',
    guest_count: 2,
    with_checkin: true,
    checkin: { surname: 'Verdi', name: 'Mario', document_number: 'FACSIMILE-01' },
    demonstration: 'Active stay and guest details',
  }),
  // DEMO-AIUTO — mid-stay with an open assistance thread.
  Object.freeze({
    code: 'DEMO-AIUTO',
    ota_id: '50505050-0000-4000-8000-000000000304',
    property_id: PROPERTY_PRIMARY.id,
    arrival_offset: -1, departure_offset: 2,
    guest_name: 'Russo — ESEMPIO',
    guest_count: 2,
    with_checkin: true,
    checkin: { surname: 'Russo', name: 'Giulia', document_number: 'FACSIMILE-02' },
    demonstration: 'Host help request and reply',
  }),
  // DEMO-GRUPPO — 3 guests, group lead + 2 members.
  Object.freeze({
    code: 'DEMO-GRUPPO',
    ota_id: '50505050-0000-4000-8000-000000000305',
    property_id: PROPERTY_PRIMARY.id,
    arrival_offset: 0, departure_offset: 2,
    guest_name: 'Famiglia Esposito — ESEMPIO',
    guest_count: 3,
    with_checkin: true,
    checkin: { surname: 'Esposito', name: 'Luca', document_number: 'FACSIMILE-03', guest_type: 'group_lead' },
    group_members: [
      { id: '50505050-0000-4000-8000-000000002351', surname: 'Esposito', name: 'Anna', document_number: 'FACSIMILE-03A', guest_type: 'group_member' },
      { id: '50505050-0000-4000-8000-000000002352', surname: 'Esposito', name: 'Marco', document_number: 'FACSIMILE-03B', guest_type: 'group_member' },
    ],
    demonstration: 'Group lead and members',
  }),
  // DEMO-CONFORMITA — simulated filing. Checkin shows filed status.
  Object.freeze({
    code: 'DEMO-CONFORMITA',
    ota_id: '50505050-0000-4000-8000-000000000306',
    property_id: PROPERTY_PRIMARY.id,
    arrival_offset: -1, departure_offset: 1,
    guest_name: 'Marino — ESEMPIO',
    guest_count: 1,
    with_checkin: true,
    checkin: { surname: 'Marino', name: 'Chiara', document_number: 'FACSIMILE-04', alloggiati_status: 'filed_facsimile' },
    demonstration: 'Simulated filing and sample receipt',
  }),
  // DEMO-PARTENZA — departure today.
  Object.freeze({
    code: 'DEMO-PARTENZA',
    ota_id: '50505050-0000-4000-8000-000000000307',
    property_id: PROPERTY_PRIMARY.id,
    arrival_offset: -2, departure_offset: 0,
    guest_name: 'Greco — ESEMPIO',
    guest_count: 2,
    with_checkin: true,
    checkin: { surname: 'Greco', name: 'Antonio', document_number: 'FACSIMILE-05' },
    demonstration: 'Departure actions',
  }),
  // DEMO-RECENTE — departed 3 days ago (inside 7-day action-board window).
  Object.freeze({
    code: 'DEMO-RECENTE',
    ota_id: '50505050-0000-4000-8000-000000000308',
    property_id: PROPERTY_PRIMARY.id,
    arrival_offset: -5, departure_offset: -3,
    guest_name: 'Lombardi — ESEMPIO',
    guest_count: 2,
    with_checkin: true,
    checkin: { surname: 'Lombardi', name: 'Elena', document_number: 'FACSIMILE-06' },
    demonstration: 'Recent activity',
  }),
  // DEMO-SCADUTO — departed 8 days ago (OUTSIDE 7-day action-board window).
  Object.freeze({
    code: 'DEMO-SCADUTO',
    ota_id: '50505050-0000-4000-8000-000000000309',
    property_id: PROPERTY_PRIMARY.id,
    arrival_offset: -10, departure_offset: -8,
    guest_name: 'Fontana — ESEMPIO',
    guest_count: 1,
    with_checkin: true,
    checkin: { surname: 'Fontana', name: 'Paolo', document_number: 'FACSIMILE-07' },
    demonstration: 'Excluded from action board',
  }),
  // DEMO-NOSHOW — departed 8 days ago, no check-in was ever submitted.
  Object.freeze({
    code: 'DEMO-NOSHOW',
    ota_id: '50505050-0000-4000-8000-000000000310',
    property_id: PROPERTY_PRIMARY.id,
    arrival_offset: -10, departure_offset: -8,
    guest_name: 'Rizzo — ESEMPIO',
    guest_count: 1,
    with_checkin: false,
    demonstration: 'No stale check-in prompt',
  }),
]);

// Seeded chat threads. Prerecorded demonstrations are labelled in the
// message body so the UI can mark them "esempio prerecorded".
export const CHAT_SEEDS = Object.freeze([
  // DEMO-SOGGIORNO: short multilingual intro (guest IT, host IT, guest EN).
  Object.freeze({ booking_code: 'DEMO-SOGGIORNO', sender: 'guest', message: 'Ciao, qual è il codice del keybox?', offset_minutes: -24 * 60 }),
  Object.freeze({ booking_code: 'DEMO-SOGGIORNO', sender: 'host',  message: 'Benvenuti! Codice keybox nel messaggio di check-in.', offset_minutes: -23 * 60 }),
  Object.freeze({ booking_code: 'DEMO-SOGGIORNO', sender: 'guest', message: 'Thanks, we are heading over now.', offset_minutes: -22 * 60 }),
  // DEMO-AIUTO: escalated assistance request.
  Object.freeze({ booking_code: 'DEMO-AIUTO', sender: 'guest', message: 'Il rubinetto della cucina perde, può aiutarci? (esempio prerecorded)', offset_minutes: -3 * 60, is_escalated: true }),
  Object.freeze({ booking_code: 'DEMO-AIUTO', sender: 'host',  message: 'Arrivo entro un’ora con il tecnico. (esempio prerecorded)', offset_minutes: -2 * 60 }),
  // DEMO-NUOVO: minimal pre-arrival nudge seed.
  Object.freeze({ booking_code: 'DEMO-NUOVO', sender: 'guest', message: 'A che ora possiamo fare il check-in?', offset_minutes: -60 }),
]);

// Engagement events seed — a short, labelled trail per scenario so the
// host analytics panel has something to show. All marked is_test=true.
export const ANALYTICS_SEEDS = Object.freeze([
  Object.freeze({ booking_code: 'DEMO-SOGGIORNO', event_type: 'session_start',       offset_minutes: -25 * 60 }),
  Object.freeze({ booking_code: 'DEMO-SOGGIORNO', event_type: 'reco_view',           offset_minutes: -22 * 60, event_data: { category: 'landmark' } }),
  Object.freeze({ booking_code: 'DEMO-SOGGIORNO', event_type: 'reco_click',          offset_minutes: -22 * 60, event_data: { category: 'landmark' } }),
  Object.freeze({ booking_code: 'DEMO-AIUTO',     event_type: 'session_start',       offset_minutes: -5 * 60 }),
  Object.freeze({ booking_code: 'DEMO-AIUTO',     event_type: 'guest_chat_message',  offset_minutes: -3 * 60 }),
  Object.freeze({ booking_code: 'DEMO-NUOVO',     event_type: 'session_start',       offset_minutes: -60 }),
  Object.freeze({ booking_code: 'DEMO-NUOVO',     event_type: 'guest_chat_message',  offset_minutes: -60 }),
]);

const DAY_MS = 24 * 60 * 60 * 1000;

// Return YYYY-MM-DD for `today` in Europe/Rome.
export function romeToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;
  return `${y}-${m}-${d}`;
}

export function addDaysISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * DAY_MS;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

// Derive the stable UUID for a check-in row from the scenario's OTA id.
// Replaces the eighth hex nibble (`03`) with `13` to keep every derived
// row distinct from the OTA reservation it belongs to while remaining a
// 12-character hex suffix. Group members carry their own explicit IDs.
export function deriveCheckinId(otaId) {
  if (!/^50505050-0000-4000-8000-0{9}3[0-9a-f]{2}$/i.test(otaId)) {
    throw new Error('deriveCheckinId: unexpected scenario ota_id shape');
  }
  return otaId.replace('-0000-4000-8000-0000000003', '-0000-4000-8000-0000000013');
}

// Derive seed IDs for chat/analytics so the hosted gate test can verify
// upserts land on predictable rows across reruns.
export function deriveChatId(index) { return `50505050-0000-4000-8000-0000000040${String(index + 1).padStart(2, '0')}`; }
export function deriveAnalyticsId(index) { return `50505050-0000-4000-8000-0000000050${String(index + 1).padStart(2, '0')}`; }

// Materialize dated scenarios around the chosen reset day. `today` must
// be YYYY-MM-DD in Europe/Rome; caller is responsible for keeping it stable.
export function buildManifest(today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error('today must be YYYY-MM-DD');
  const scenarios = BOOKING_SCENARIOS.map(scenario => Object.freeze({
    ...scenario,
    checkin_date: addDaysISO(today, scenario.arrival_offset),
    checkout_date: addDaysISO(today, scenario.departure_offset),
    nights: scenario.departure_offset - scenario.arrival_offset,
  }));
  return Object.freeze({
    projectRef: DEMO_PROJECT_REF,
    today,
    presenters: PRESENTERS,
    properties: PROPERTIES,
    recommendations: RECOMMENDATIONS,
    rules: RULES,
    scenarios,
    chat: CHAT_SEEDS,
    analytics: ANALYTICS_SEEDS,
  });
}
