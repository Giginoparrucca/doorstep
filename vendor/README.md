# Browser dependency provenance

`supabase-2.118.0.js` is the unmodified `dist/umd/supabase.js` from
`@supabase/supabase-js@2.118.0`, downloaded from the official npm registry.
The archive SHA-512 was checked against registry metadata before extraction.
The MIT license is retained in `supabase-LICENSE`. Upstream:
https://github.com/supabase/supabase-js/tree/v2.118.0

Production's previously floating CDN URL resolved to this version when Round 65
was implemented. All four HTML entry points now load these same-origin bytes
with SHA-384 Subresource Integrity. The older demo launcher is aligned to that
same SDK; its configuration boundary is covered by the browser regression.

The exact devDependency and lockfile make the SDK visible to npm/Dependabot
advisory and update checks. Updating the package alone does **not** update the
browser artifact. For an SDK update, verify the official archive integrity, copy
the unmodified UMD file and license, change the versioned filename and all four
HTML SRI values, update the pinned dependency/lock, and run the whole suite plus
preview/production browser integrity checks. Do not restore a floating CDN URL.

Playwright is pinned to the version already used by CI (1.56.1); PGlite 0.3.14 is
a development-only disposable PostgreSQL fixture for the actual SQL security
tests. Neither is a production database or browser-delivered dependency.
