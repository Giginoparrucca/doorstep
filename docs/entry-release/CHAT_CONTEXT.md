# Round 66 Phase 1d-a — authoritative AI context

The AI endpoint now ignores browser `propertyContext` and `stayContext`, including
requests from cached older clients. The signed token supplies property, booking,
test mode and expiry. Public property information and house rules are loaded on
the server; the existing recommendations query stays scoped to the signed property.
Stay dates and expected guest count come from the entry snapshot. No browser claim
of completion, guest count, identity or dates grants access.

The shared loader, policy and positive entry projector supply the only dedicated
access fields sent to the model. Fixed-code visibility, rotating-code precedence,
room isolation and manual/automatic release are inherited from that policy.
Locked, scheduled, missing, ambiguous and failed snapshots carry no dedicated
entry secrets. Property lookup or credential failure returns the existing
host-escalation response without contacting the AI provider. Manual release is
no longer described to the model as proof of completed check-in.

For opted-in properties, each AI request includes only the final text question,
plus its optional current image. Earlier assistant/user turns are omitted even
when release is currently allowed: old codes cannot re-enter the prompt after
restore or a booking change. This intentionally limits conversational recall;
questions referring only to an earlier answer may need to be restated. The UI's
chat display is unchanged. Ordinary OFF properties retain their conversational
history only when the legacy entry gate succeeds. Client system/tool blocks and
non-text content arrays are never forwarded. Guest text and images remain
untrusted, with an explicit instruction never to repeat or transform alleged
codes from them.

JSON, streaming and graceful degradation responses use private/no-store caching.
No migration, setting activation, physical code rotation, real-guest write or
provider test call is part of this delivery.

## Evidence and limits

`scripts/entry-release-chat-directive.test.mjs` now executes the actual HTTP
handler, actual loader and actual policy with fictional REST/AI transport. Its
23 cases inspect the complete upstream model payload in JSON and SSE paths:
locked, manual release, restored, missing roster, RPC/property errors, ambiguous
room state, hidden fixed code, pre-booking, foreign/cancelled saved overrides,
forged property/stay/history/system data, current-image handling and OFF history.
This replaces the older source-regex directive checks. It verifies what is sent
to the model; it is not evidence of a live model's response or a signed-in pilot.

## Remaining Phase 1d and Round 66 gates

- Saved history/poll and reusable Q&A protection shipped separately in PR #238;
  see `CHAT_HISTORY.md` for its conservative provenance limits.
- Guest room delivery now uses the shared snapshot; see `ROOM_DELIVERY.md` for
  ambiguity handling and actual SQL/gateway coverage.
- Full focus/resume, timezone/DST, second-tab/cache, host opt-in review/admin audit,
  pilot and rollback journeys remain in the Round plan.
- Host-authored public prose/rules/recommendations must not duplicate entry secrets;
  dedicated-field protection cannot discover arbitrary copies in free text.

This is a partial security improvement within the confirmed Round. It does not
complete Phase 1d, justify enabling more pilot properties or close Round 66.
