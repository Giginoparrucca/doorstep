(function(root){
'use strict';
// Round 61 Phase 1 — National CIN (Codice Identificativo Nazionale) parsing.
//
// The CIN is the national accommodation code introduced by art. 13-ter of
// d.l. 145/2023 (converted by l. 191/2023), assigned by the Ministero del
// Turismo via the BDSR portal (bdsr.ministeroturismo.gov.it). It replaces
// the older regional CIR/CIS/CITR codes for identification purposes.
//
// Format (per the publicly-cited structure, 18 characters):
//   "IT" (2) + <ISTAT_prov> (3) + <ISTAT_comune> (3) + <tipologia> (2) + <progressive> (8)
// Example from prod: IT074003C200109603
//   IT | 074 (Brindisi) | 003 (Carovigno) | C2 (tipologia) | 00109603 (progressive)
//
// Service detection (Round 61 B+D cascade): the host chose the legal
// category when they registered the property. Alberghiero and
// extralberghiero use SPOT Online; locazione turistica uses SPOT Easy.
// The TIPOLOGIA 2-character code encodes this choice, BUT the Ministero
// del Turismo decreto's annex A (the official letter→category table) is
// not publicly accessible as of 2026-10-19. Until the mapping is confirmed
// from an authoritative source (Ministero or ARET technical support), the
// `serviceFromCIN` function returns `null` for every valid CIN — the
// detection cascade falls through to the property_type heuristic. This is
// an explicit degradation: no guessed mapping ever ships.
//
// When the mapping is confirmed, populate `TIPOLOGIA_SERVICE` below with a
// citation comment and `serviceFromCIN` becomes deterministic for every
// listed letter; unlisted letters still fall through so an unexpected code
// never silently misroutes.

// Format: 2 letters "IT" + 6 digits (ISTAT) + 2 alphanumeric (tipologia) + 8 alphanumeric (progressive).
// Case-insensitive on the "IT" prefix. Trim whitespace before matching.
const NATIONAL_CIN_RE = /^IT(\d{3})(\d{3})([A-Z0-9]{2})([A-Z0-9]{8})$/;

// Authoritative letter→service mapping. EMPTY until confirmed from the
// Ministero del Turismo decree annex A or ARET technical support (see PLAN).
// Example when confirmed (do NOT uncomment on a guess):
//   // Source: Decreto Ministero del Turismo 6 giugno 2024, Allegato A, cit.
//   // https://www.gazzettaufficiale.it/eli/id/2024/06/26/...
//   'A1': 'spot_online', // alberghiero: hotel 1 stella
//   'E1': 'spot_online', // extralberghiero: B&B
//   'L1': 'spot_easy',   // locazione turistica: casa vacanze
//   ...
const TIPOLOGIA_SERVICE = Object.freeze({});

function parseCIN(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toUpperCase();
  const match = NATIONAL_CIN_RE.exec(trimmed);
  if (!match) return null;
  return {
    isNationalCIN: true,
    istatProv: match[1],
    istatComune: match[2],
    tipologia: match[3],
    progressive: match[4],
    full: trimmed,
  };
}

function serviceFromCIN(cir_code) {
  const parsed = parseCIN(cir_code);
  if (!parsed) return null;
  const mapped = TIPOLOGIA_SERVICE[parsed.tipologia];
  // Mapping is empty today (per the degradation clause). Returns null so
  // the cascade falls through to the property_type heuristic.
  return mapped || null;
}

// property_type → service inference (B — fallback for the obvious cases).
// A null return means "ambiguous, ask the host".
//
// Confident SPOT Online (strutture ricettive alberghiere/extralberghiere):
//   bnb, hotel, agriturismo, affittacamere, guesthouse
// Ambiguous (any of these can legally be either category):
//   apartment, house, villa, trullo, loft, studio, other, '', null
const SPOT_ONLINE_PROPERTY_TYPES = new Set([
  'bnb', 'hotel', 'agriturismo', 'affittacamere', 'guesthouse',
]);

function serviceFromPropertyType(property_type) {
  if (typeof property_type !== 'string') return null;
  const normalized = property_type.trim().toLowerCase();
  if (!normalized) return null;
  if (SPOT_ONLINE_PROPERTY_TYPES.has(normalized)) return 'spot_online';
  return null; // ambiguous — ask
}

// Full B+D cascade. Call this when `property.regional_service` is null and
// region='Puglia'. Returns one of:
//   { service: 'spot_online'|'spot_easy', source: 'cin'|'property_type' } → auto-save
//   { service: null, source: 'ask' } → render the one-time ask dialog
function detectService(property) {
  if (!property) return { service: null, source: 'ask' };
  // Step 1: CIN TIPOLOGIA parse. Silently skipped until mapping is confirmed.
  const fromCIN = serviceFromCIN(property.cir_code);
  if (fromCIN) return { service: fromCIN, source: 'cin' };
  // Step 2: property_type heuristic.
  const fromType = serviceFromPropertyType(property.property_type);
  if (fromType) return { service: fromType, source: 'property_type' };
  // Step 3: genuine ambiguity.
  return { service: null, source: 'ask' };
}

const api = {
  NATIONAL_CIN_RE,
  TIPOLOGIA_SERVICE,
  SPOT_ONLINE_PROPERTY_TYPES,
  parseCIN,
  serviceFromCIN,
  serviceFromPropertyType,
  detectService,
};
root.Cin = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
