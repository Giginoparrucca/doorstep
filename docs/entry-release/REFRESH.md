# Round 66 Phase 2g — guest entry freshness

The guest page re-fetches its complete entry projection after a saved submission,
when focused/resumed, on page-cache return, on reconnect, and at least every
60 seconds while visible and online. Near a scheduled release it requests a fresh
server decision shortly after the supplied absolute instant. A timer, browser
clock or another tab's signal never grants entry by itself.

Every refresh immediately removes previously displayed fixed/rotating/room codes,
access/check-in instruction text and Wi-Fi values, including translation values and old check-in-row
code copies. Hidden/pagehide/offline events invalidate pending responses and clear
these surfaces. Failed or 15-second timed-out reads remain unavailable, with
Retry/contact-host guidance and a modest retry timer. Older and changed-scope
responses cannot replace a newer result. URL history changes clear the old view
and reload into the new property/booking scope.

Property responses now carry the permitted rotating code alongside fixed/room
fields from the same snapshot and server-clock instant. The old separate keybox
endpoint remains for older clients. The new page no longer revives a rotating
code from a previously loaded check-in row. Existing fixed/rotating visibility
and server precedence are preserved.

Scheduled text uses the server-provided property IANA timezone and explicitly
names it. An invalid/missing timezone shows unavailable guidance; the device
locale controls wording, never the property's wall-clock time. Language switches
re-render the current projection. Server DST policy is unchanged (later repeated
minute; spring gap advances conservatively).

A successful save writes only a random invalidation nonce to localStorage. Other
tabs re-fetch their own pinned scope; no code, decision or guest information is
broadcast. The page removes the known old `wbnb_`/`doorstep_` property-data,
check-in and entry-code payload keys from local/session storage. It preserves
unrelated host/auth data and identity-only submission retry keys. Current entry
payloads remain in memory only, with private/no-store API responses and no-store
client requests. The host push worker has no fetch/cache handler.

Token minting is fenced by property/booking/test scope. Same-scope requests share
a pending mint; a later response for an old booking cannot overwrite the current
token or its session cache. Lookup and URL changes invalidate the old view.

## Tests and limits

`guest-entry-refresh-browser.test.mjs` loads the actual complete guest HTML,
production controller, token wrapper and renderers, intercepting every network
request with fictional data. IT/EN at 390/1440 widths cover final-save surfaces,
focus, property timezone/DST on a Singapore device, timer rechecks, page-cache
callbacks, offline/error/Retry, stale replies, booking navigation, visibility,
storage cleanup and two-tab invalidation. The controller and token-mint tests
also execute actual code with controlled timers and out-of-order responses.
Existing submission, fixed-code, consent and room gateway suites remain in the
full regression gate. This is synthetic browser evidence, not a signed-in hosted
pilot or a live AI conversation.

Already viewed/copied codes and operating-system screenshots cannot be recalled.
This delivery clears dedicated entry surfaces, not arbitrary host-authored prose
or an active AI stream. Saved chat has the server provenance boundary documented
in `CHAT_HISTORY.md`; full conversation/browser integration remains an integrated
pilot/rollback gate. Host opt-in content review, admin/audit journeys and safe
activation remain separate Round 66 acceptance work. No property is auto-enabled,
no physical lock is changed, and no real guest/provider write is part of tests.
