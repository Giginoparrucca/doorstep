# WelcomeBnB — Guest App polish

Paste everything below into Claude Code, in the repo root.

---

## Context

`index.html` is the guest-facing app (vanilla JS, Supabase, `showPage()`
navigation, `data-h` i18n keys, CSS custom properties in `:root`). It is live at
welcomebnb.vercel.app and two early-adopter hosts are being onboarded this week.

The app works and the content is right. These tasks fix three visible defects
and one systemic visual problem. None of them change behaviour, data, or any
compliance path.

**Guardrails — read before writing any code:**

- Do **not** change the check-in form logic, the document-scan flow
  (`api/scan-document.js`), Alloggiati field mapping, or any Supabase query.
- Do **not** rename existing `data-h` i18n keys. Add new ones; never repurpose.
- Do **not** redesign the hero, the bottom nav, or the page structure. They are
  working well.
- Tasks 1–3 are independently shippable bug fixes. Do them first, commit after
  each, and stop for review before Task 4.
- Keep the existing design tokens (Playfair Display + DM Sans, cream/navy/blue).

Reference screenshots of the current state are in `uploads/`.

---

## Task 1 — The floating Privacy button covers content

**Bug:** a fixed-position "Privacy" button sits at the bottom-right of the
viewport on every page. It overlaps the WiFi and Emergency cards on Home, the
second recommendation card on Explore, and the "No Parties / Events" rule on
Rules. It also overlaps the "Powered by WelcomeBnB" bar.

Privacy is a once-ever link, not a persistent action.

1. Remove the floating button entirely.
2. Add "Privacy" as a text link inside the existing "Powered by WelcomeBnB"
   footer strip, to the right of the wordmark, at the same muted weight.
3. Keep the existing privacy modal and its open/close handlers — only the
   trigger moves.
4. Verify no card content is clipped at 390×844 on Home, Rules and Explore.

---

## Task 2 — Both languages render simultaneously

**Bug:** on Home, the Check-in Time card shows the Italian paragraph *and* the
English paragraph stacked, while the EN toggle is active. Same on "Getting
around" and "Check-out time". The host has entered both languages into a single
free-text field, so the language toggle cannot filter them.

This doubles the length of the Home page and makes the app look unfinished.

**Host console side** (`host-console.html`, Property Details panel):

1. For every free-text property field that guests see — check-in instructions,
   check-out instructions, getting around, welcome message, WiFi notes,
   emergency notes — split storage into two columns, `<field>_it` and
   `<field>_en`. Write a Supabase migration that adds the new columns and
   leaves the original column in place, untouched, as a backup.
2. In the editor UI, render a small IT/EN tab above each of these fields so the
   host edits one language at a time. Mirror the pill-toggle component already
   used in the console header.
3. Add a one-off migration helper (a button in the console, or a script — your
   call) that attempts to split existing double-language entries on a blank-line
   boundary and pre-fills the two new columns, leaving the host to confirm. Do
   not auto-commit the split; show a diff and require a save.

**Guest app side** (`index.html`):

4. Read `<field>_<lang>` based on the active language, falling back to the
   original column if the new one is empty — so nothing disappears for hosts who
   haven't migrated yet.
5. If only one language is populated, show it regardless of toggle state rather
   than showing an empty card.

---

## Task 3 — Small content defects on Home

1. **"CODE — N/A".** The check-in card renders a dashed box containing "N/A"
   when the property has no door code. Hide the element when there is no code,
   rather than displaying its absence.
2. **Truncated emergency number.** The Emergency card clips mid-digits
   (`112 · Daniele: +6-8…`). A phone number that can't be read is worse than
   none. Let the card grow to fit, or wrap the number onto its own line. Make
   the number a `tel:` link while you're in there.
3. **Property name appears twice** in the first 200px — once in the sticky
   header bar, once in the hero headline. On the Home page only, hide the
   header title and let the hero carry it. Keep the header title on Check-in,
   Rules, Explore and Chat.
4. **Bottom chrome.** Between the "Powered by" bar and the nav, roughly 180px
   of an 844px viewport is permanent furniture. Fold the "Powered by" strip into
   the top of the nav bar, or reveal it only when the page is scrolled to its
   end.

**Stop here for review.**

---

## Task 4 — Replace all emoji with line icons

**The systemic issue.** The app uses emoji as its icon system: 🛬 🏡 👋 📍 🕐
📶 🚨 🚍 🚪 📌 👥 🍝 🍷 👁 🏖 🛍 ✨ 🐟 🔥 and others. On Android these render
as Samsung's photo-realistic set — a glossy 3D pin, a cartoon bus, a chrome
siren — directly beneath Playfair Display and real property photography. They
undercut the quality of everything around them, and they render differently on
every OS so you cannot predict what a guest sees.

The bottom nav already uses clean 1.6-stroke line icons and looks right. Extend
that system to the whole app.

1. Build a single inline SVG sprite (or a small `icon(name)` helper returning an
   SVG string) with 1.6 stroke weight, `currentColor`, 24×24 viewBox — matching
   the existing nav icons exactly.
2. Replace every emoji with a sprite icon. The set needed:
   - **Home sections:** arriving (plane), staying (house), leaving (wave/door)
   - **Home cards:** address (pin), check-in time (clock), wifi (signal),
     emergency (alert-triangle), getting around (car), check-out (door)
   - **Rules:** a single neutral marker — see task 5
   - **Explore filters:** food, drinks, see, beach, shop, experiences
   - **Explore tags:** the per-item tags (seafood, must-try, nearby, …) should
     drop their emoji and be text-only chips
   - **Check-in:** camera, gallery, person, family, group, key
   - **Chat:** the concierge and host indicators
3. Sweep for any remaining emoji in i18n strings and in host-entered content
   defaults. Guest-entered content is out of scope.
4. Do not change any icon's position, size or colour — only its rendering.

Verify on Android Chrome and iOS Safari that no emoji remain in app chrome.

---

## Task 5 — Rules: stop making every rule look like an alarm

Every House Rules card currently has a red left border and a pushpin icon, so
"Cleaning tools" carries the same visual urgency as "No Parties / Events".

1. Give each rule a `severity` of `info` (default) or `restriction`.
2. `info` renders with a neutral border and a muted icon. `restriction` keeps
   the red left border.
3. In the host console's Rules editor, add a simple two-option control so the
   host sets severity per rule. Default existing rules to `info`, except any
   whose title matches a short restriction list (parties, smoking, pets, noise,
   quiet hours) — default those to `restriction` and let the host correct.

---

## Task 6 — Explore filter chips

Seven chips wrap onto two rows and each carries an emoji. After Task 4 removes
the emoji they will be narrower. Check whether they now fit one scrollable row;
if they do, make the row horizontally scrollable with the active chip scrolled
into view rather than wrapping.

---

## Definition of done

- No console errors on load or when navigating all five pages.
- No content is clipped or overlapped at 390×844, 414×896 and 360×800.
- No emoji remain in app chrome on Android Chrome or iOS Safari.
- A property with only legacy single-column content still renders correctly
  (fallback path from Task 2.4 works).
- The check-in flow, document scan and Alloggiati export are untouched — verify
  a fixture booking produces a byte-identical `.txt` before and after.
- Italian and English both render with no missing-key fallbacks.

---

## Not in this pass — deliberately

The Atlante visual redesign (new palette, map-based Home) is a separate,
later piece of work. Do not begin it here. These tasks are intended to leave
the current design intact and simply correct.
