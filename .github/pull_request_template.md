<!--
Round 60a Phase 3 — PR checklist.
Keep it short; the CHANGELOG entry carries the detail.
-->

## Summary

<!-- 1–3 bullets on what changed and why. -->

## Test plan

- [ ] `npm run test:all` green locally (PASS / FAIL / SKIP totals pasted into CHANGELOG)
- [ ] `regression` CI check green on this PR
- [ ] CHANGELOG updated: Round / Phase entry with the real pass/skip counts and any named-blocker skips
- [ ] Any new feature, endpoint or export ships with at least one test joining the full suite
- [ ] Compliance outputs (Alloggiati, SPOT, regional statistics, tourist tax) compared byte-for-byte against a committed synthetic golden
