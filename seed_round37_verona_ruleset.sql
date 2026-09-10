-- Round 37 — seed the Verona locazione_turistica ruleset.
--
-- Sources:
--   Delibera di Giunta n. 422 del 19/04/2024  — rate table + reductions
--   Delibera di Consiglio n. 32 del 09/05/2024 — reduced cap from 5 to 4 nights
--   Regolamento Comunale imposta di soggiorno art. 4 bis — exemption list
--
-- TODO — Direzione Tributi confirmation: the delibera reads "fino ad un
-- massimo di 4 pernottamenti" with no qualifier. At least one secondary
-- source treats it as per person per month. Seeded here as per_stay
-- because the delibera does not say otherwise; revise max_nights_basis
-- once the comune confirms in writing.
--
-- Reductions we DO encode as auto-applied (only when the guest's data
-- proves them): minors 0–14 exempt, youth 15–25 −20%, over-70 −20%,
-- groups > 25 −20%. The last two rules (resident_comune, disability)
-- are `declared`-gated — the host must explicitly tick the checkbox in
-- the guest detail modal, since documentation must be retained.

BEGIN;

INSERT INTO public.tax_rulesets (
  comune, provincia, istat_code, structure_type,
  base_rate_eur, max_nights, max_nights_basis,
  rules, stacking,
  source_citation, source_url,
  valid_from, valid_to, verified_at
) VALUES (
  'Verona', 'VR', '023091', 'locazione_turistica',
  3.50, 4, 'per_stay',
  '[
    {
      "id": "minors",
      "when": { "age_max": 14 },
      "effect": { "type": "exempt" },
      "label_it": "Minori fino a 14 anni compiuti",
      "label_en": "Children up to and including age 14"
    },
    {
      "id": "youth_15_25",
      "when": { "age_min": 15, "age_max": 25 },
      "effect": { "type": "percent_off", "value": 20 },
      "label_it": "Giovani 15–25 anni",
      "label_en": "Young people aged 15–25"
    },
    {
      "id": "over_70",
      "when": { "age_min": 70 },
      "effect": { "type": "percent_off", "value": 20 },
      "label_it": "Ospiti oltre 70 anni",
      "label_en": "Guests over 70"
    },
    {
      "id": "large_group",
      "when": { "group_size_min": 26 },
      "effect": { "type": "percent_off", "value": 20 },
      "label_it": "Gruppi oltre 25 persone",
      "label_en": "Groups of more than 25"
    },
    {
      "id": "resident",
      "when": { "declared": "resident_comune" },
      "effect": { "type": "exempt" },
      "requires_documentation": true,
      "label_it": "Residenti nel Comune",
      "label_en": "Residents of the comune"
    },
    {
      "id": "disability",
      "when": { "declared": "disability" },
      "effect": { "type": "exempt", "includes_companion": true },
      "requires_documentation": true,
      "label_it": "Disabili non autosufficienti e accompagnatore",
      "label_en": "Non-self-sufficient disabled guests and companion"
    }
  ]'::jsonb,
  'best_single',
  'Delibera di Giunta n. 422 del 19/04/2024; Delibera di Consiglio n. 32 del 09/05/2024; Regolamento Comunale art. 4 bis',
  'https://www.comune.verona.it/',
  DATE '2024-05-09', NULL, CURRENT_DATE
)
ON CONFLICT (comune, structure_type, valid_from) DO UPDATE
  SET base_rate_eur = EXCLUDED.base_rate_eur,
      max_nights = EXCLUDED.max_nights,
      max_nights_basis = EXCLUDED.max_nights_basis,
      rules = EXCLUDED.rules,
      stacking = EXCLUDED.stacking,
      source_citation = EXCLUDED.source_citation,
      source_url = EXCLUDED.source_url,
      valid_to = EXCLUDED.valid_to,
      verified_at = EXCLUDED.verified_at;

-- Link both Marco Polo properties. Legacy columns stay in place as the
-- fallback in case the ruleset is later unlinked.
UPDATE public.properties
   SET tax_ruleset_id = (
     SELECT id FROM public.tax_rulesets
      WHERE comune = 'Verona' AND structure_type = 'locazione_turistica'
      ORDER BY valid_from DESC LIMIT 1
   )
 WHERE id IN (
   '68f2e874-a9c5-4e78-8b33-c4cc9840dc89',
   'a700914c-0706-4c9e-911c-c5bb2ef974c6'
 );

COMMIT;
