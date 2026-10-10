# Round 50 Phase 2: hosted gate

`vercel.mjs` selects deployment configuration before the build. Demo registers no cron jobs; production retains the existing schedules, routes, headers and function settings. Invalid environment modes and demo project metadata without explicit demo mode fail closed. Do not edit configuration during the build and assume cron registration changes retroactively.

The live smoke script is a partial check, not the whole phase gate. It checks the exact demo configuration before any POST, requires explicit integration-denial responses, and requires a successful token mint plus a real guest-gateway response for an existing disposable test property. Missing configuration, generic 404/503 responses and missing test properties fail. A request for a nonexistent Storage object does not prove bucket privacy.

Run:

```sh
node scripts/deployment-config.test.mjs
node scripts/demo-live-smoke.test.mjs
DEMO_SMOKE_PROPERTY_ID=<disposable-demo-property-uuid> node scripts/demo-live-smoke.mjs <verified-demo-origin>
```

Mandatory separate hosted evidence still includes Auth login/redirects, actual private object upload and authorized read, unauthorized read/update denial across two owners, cross-environment guest tokens, phone/QR access, no external integration traffic, clean rebuild and recovery. Mocked smoke regressions are not hosted evidence.

Local configuration/smoke regressions and existing environment, guest-check-in and autofile due-time regressions passed. Deployment verification remains pending. Phase 2 remains in progress; later phases have not started.

Provisioning update: dedicated deployment reached READY, with isolated configuration and Secret server credentials. Auth settings verified closed signup and no anonymous users; exact demo host/admin redirects are saved. This does not satisfy login, object-level isolation or guest/phone tests. Deployment protection remains enabled after automatic review rejected public-access change without explicit approval. Protected connector fetch also failed. No hosted smoke success is claimed. Complete the remaining gate before marking the phase shipped.
