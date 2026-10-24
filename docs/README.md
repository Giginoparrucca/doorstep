# WelcomeBnB developer documentation

Read [AGENTS](../AGENTS.md), [CHANGELOG and roadmap](../CHANGELOG.md) and
[release/rollback guide](../RELEASE.md) before work. Plans document intended work;
only recorded implementation/test/deployment evidence establishes a live feature.

## iReservation native API — Round 63

- [Implementation plan and phase gates](../PLAN_round63_ireservation_native_api.md)
- [Complete nonsecret API contract and source register](ireservation/API_REFERENCE.md)
- [Credential setup, storage, rotation and operational rollback](ireservation/OPERATIONS.md)
- [Developer / Claude / GPT continuation guide](ireservation/CONTINUATION.md)
- [Sanitized official schema snapshot](ireservation/schema.snapshot.json)

Status: Phase 1 secure provisioning and real test-property reads verified. Phase 2 shipped in PR #197 and
adds owner-only connection, explicit room mapping and manual comparison; release
evidence is in CHANGELOG. Calendar imports/cutover remain gated. Provider availability
reads are not currently available. Supplied secrets/private calendar links and
raw credential-bearing source examples must never enter this public repository.

## Existing guides

- [Demo onboarding (Italian)](DEMO_ONBOARDING_IT.md)
- [Demo environment](ROUND50_ENVIRONMENT.md), [provisioning](ROUND50_PROVISIONING.md),
  [hosted gate](ROUND50_HOSTED_GATE.md)
- [Regional export formats](REGIONAL_EXPORT_FORMATS.md), [SPOT reference](spot/README.md)

The actual in-app IT/EN host guides live in `host-guides.js`; update them when
shipped host behavior changes, following RELEASE's guide-version/target checks.
