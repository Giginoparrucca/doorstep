# WelcomeBnB — Host Console simplification

Paste everything below into Claude Code, in the repo root.

---

## Context

`host-console.html` is a single-file host console (vanilla JS, Supabase,
`showPanel()` navigation, `data-h` i18n keys, CSS custom properties in `:root`).
It works, but two early-adopter hosts are being onboarded this week and the
navigation and a few screens are confusing. There is also a data-integrity bug.

**Guardrails — read before writing any code:**

- Do **not** change any Supabase query, RPC, table, or API route unless a task
  explicitly says so.
- Do **not** touch the Alloggiati `.txt` generation logic, the ROSS1000 XML
  builder, or the iCal sync. Those are load-bearing and hard to test.
- Do **not** rename `data-h` i18n keys. Add new ones; never repurpose old ones.
- Every task below is independently shippable. Do them in order, commit after
  each, and stop for review after Task 3.
- Keep the existing design tokens (`--warm`, `--ink`, `--cream`, Playfair
  Display + DM Sans). This is a structure change, not a visual redesign.

A visual reference mock of the target state is at
`host-console-simplified.html` (static, no backend). Match its structure,
not its exact copy.

---

## Task 1 — Fix the check-in table column overlap

**Bug:** on the Check-in Data panel, the `<thead>` declares more columns than
the body rows render, so the "AZIONI" header paints over "CITTADINANZA" and
"DOCUMENTO".

Find the check-in table markup and its row-rendering function. Make the header
and body column counts match exactly. If cittadinanza/documento are meant to be
visible, render them in the rows; if they belong in the detail view only, remove
them from the header.

Verify: at 1440px and 1024px wide, no header text overlaps.

---

## Task 2 — Reject impossible dates of birth

**Bug:** a guest row shows date of birth `24/09/2026` — a future date. This came
from the document scan and will be rejected by Alloggiati at submission time,
where the host has no context to fix it.

1. In `api/scan-document.js`, after the model returns parsed fields, validate
   `date_of_birth`: must parse as a real date, must be in the past, and must be
   more than 1 year ago. On failure, return the field as `null` plus a
   `warnings: ['date_of_birth_invalid']` array on the response.
2. In the guest check-in form (`index.html`), if `date_of_birth` came back null
   or warned, leave the field empty and focus it with an inline message rather
   than silently filling garbage.
3. In the host console check-in table, render any row with a missing or
   future-dated `date_of_birth` with a red inline chip reading
   "Data di nascita non valida" / "Invalid date of birth" (new `data-h` keys) so
   the host can fix it before the export.
4. Add the same guard to the Alloggiati export: if any guest in the selected set
   has an invalid DOB, block generation and list the offending guests.

---

## Task 3 — Login: timeout and recovery

The login button can sit on "Accesso in corso…" indefinitely if the auth call
hangs. Add a 15-second timeout to the sign-in request. On timeout, restore the
button label, keep the entered email, and show an inline error with a retry
affordance. Also make the login language switcher use the same pill-toggle
component as the console header, not the two square buttons it has now.

**Stop here for review.**

---

## Task 4 — Collapse the sidebar to five items

Today the sidebar has 11 items across 4 group headers, plus its own inner
scrollbar — so "Export & Conformità", the most important item, sits below the
fold inside a nested scroll region.

Restructure to five top-level items, no group headers, no inner scroll:

| New item | Absorbs (as tabs) |
|---|---|
| **Oggi** | dashboard |
| **Ospiti** | checkins, calendar view, guestanalytics, contacts |
| **Conformità** | export, compliance |
| **Proprietà** | property, rules, recos |
| **Condividi** | qrlink, chat |

Implementation notes:

- Keep `showPanel(id)` and every existing panel `id` intact. Add a thin routing
  layer above it: `showSection(sectionId, tabId)` sets the sidebar active state,
  renders the tab strip, and calls the existing `showPanel()` for the target
  panel. No panel markup moves.
- The tab strip lives in the main header under the page title (see mock).
- Remember the last-used tab per section in `localStorage` under a new key.
- Deep links must keep working: if any existing URL or code calls
  `showPanel('export')` directly, it should resolve to Conformità → Export with
  the right sidebar and tab state.
- Add a count badge on **Oggi** (items needing attention) and **Conformità**
  (overdue obligations). Both already computable from data the dashboard loads.
- New `data-h` keys for the five labels; keep old sidebar keys in the i18n table
  so nothing breaks if referenced elsewhere.

Verify: sidebar has no scrollbar at 768px viewport height; every old panel is
still reachable; browser refresh lands back on the same section and tab.

---

## Task 5 — Dashboard: list first, calendar moved

- Make the **list** view the dashboard default; remove the Lista/Calendario
  toggle from the dashboard.
- Move the calendar into **Ospiti → Calendario** as its own tab, unchanged.
- In each booking row, replace the full guest URL with the booking code chip.
  Keep the Copia and Apri buttons (Copia still copies the full URL).
- Cap the dashboard list at 3 bookings with a "Mostra tutte (N)" expander.

---

## Task 6 — Check-in table: reduce action weight

- Make the whole guest row clickable to open the existing detail view. Remove
  the "Vedi" button.
- Collapse "Modifica" and "Elimina" into a `⋯` menu button at the row end.
- Remove "Elimina Tutto" from the table toolbar. Relocate it to
  Proprietà → Privacy & dati, gated behind a confirmation that requires typing
  the property name.
- Replace the raw DB values `group` / `group_member` with localised labels
  ("Capogruppo" / "Ospite", "Group lead" / "Guest"). Display only — do not
  change the stored values.

---

## Task 7 — Conformità: show only the property's region

The export page currently renders Veneto ROSS1000, Puglia SPOT Easy and every
other regional portal to every host. The property's region is already known.

- Read the property's region and render only the national obligation
  (Alloggiati) plus that region's statistical portal.
- Put the rest under a collapsed "Altre regioni" disclosure at the bottom.
- Restructure the page from a catalogue of generators into a status checklist:
  each obligation is one row with a state (done / due / optional), a one-line
  description with its deadline, and a single primary action. See the mock's
  Conformità view.
- If the property has no region set, show all portals as today plus a prompt to
  set the region in Proprietà.

---

## Task 8 — Consistency pass

- Replace emoji icons (📅 📊 🛂 🏨 🔴 🟢 ✨ 👋 and the rest) with the same
  1.6-stroke line SVGs already used in the sidebar. Emoji render inconsistently
  across OSes and clash with the Playfair/DM Sans type.
- On Dettagli Proprietà, convert the floating "Modifica / Anteprima come ospite"
  card into a sticky header bar inside the panel.
- Audit the three button styles in use and reduce to the existing `.btn`,
  `.btn.pri`, `.btn.sm` set.

---

## Definition of done

- No console errors on load or when navigating every section and tab.
- Every panel that existed before is still reachable.
- Alloggiati `.txt` output is byte-identical for a fixture booking before and
  after this work. Verify this explicitly — it is the one thing that must not
  change.
- Italian and English both render with no missing-key fallbacks.
- Tested at 1440px, 1024px and 390px wide.
