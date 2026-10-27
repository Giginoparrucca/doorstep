# Round 65 CSP observation gate

Phase 5a deploys the full resource policy in `Content-Security-Policy-Report-Only`.
The smaller enforced policy blocks framing, base-tag changes and embedded objects.
X-Frame-Options, HSTS, nosniff, referrer and permissions headers enforce immediately.
The camera remains available to the same origin for document scanning.

Full resource enforcement (Phase 5b) requires **at least seven days after the
verified Phase 5a production deployment**, followed by an explicit review. A date
alone does not pass this gate. Record the deployment/time and earliest review in
CHANGELOG. Do not auto-switch based on elapsed time or an empty log search.

During an active review, inspect Vercel runtime logs for `[csp-report]` on
`/api/csp-report`; retain only date, page bucket, directive, resource bucket and
counts in the release record. The endpoint deliberately drops URLs, query strings,
referrers, samples and all raw report data, and caps logs per warm instance. Missing
logs, traffic, browser reporting support, expired provider retention or capped
reports mean incomplete evidence. No background monitor is implied by this file.

Exercise guest home/recommendations/maps, check-in camera/photo upload, signed
guest link, host/admin login, property/room edits, calendar and chat, exports/PDF
receipts, push subscription/service worker, mobile/desktop and Italian/English.
Inspect browser `securitypolicyviolation`/console output as well as diagnostics.
Use synthetic accounts/data; never put real guest URLs, documents or codes in
reports or screenshots. Existing browser tests cover the full host login and the
changed dynamic handlers; they do not replace this signed-in flow review.

Fix legitimate violations by adding the narrowest needed source or removing the
dependency. Do not add `unsafe-eval`, wildcards for scripts/connections or disable
TLS protection as a shortcut. Existing inline event handlers still require
`unsafe-inline`; their broader migration is deferred Phase 5c.

After the watch and flow review pass, claim Phase 5b, promote the full resource
policy to the enforced header, rerun the whole suite, CI and production header/
flow checks. Keep reporting enabled. If it breaks a legitimate flow, restore the
previous report-only resource policy and verify the rollback; retain the small
enforced framing/base/object policy and the other security headers.


## 27 October observation note

A production `[csp-report]` count query over the recent 30 minutes returned no groups. The 1-hour boundary was rejected by the provider because it exceeded the Hobby runtime-log retention window; the narrower query succeeded. This exposes a retention/coverage gap, not seven days of clean traffic. Preserve browser flow evidence and sanitized counts during actual active reviews. Empty recent counts do not advance Phase 5b or substitute for the signed-in flow review. No log drain, paid observability plan or unattended monitor was configured.
