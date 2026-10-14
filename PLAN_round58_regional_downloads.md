# Round 58 — Regional statistical downloads

## Phase 1
Research the official current documentation for every Italian region, treating
Trentino and Alto Adige separately and Toscana by province where necessary.
Record portal, import format/version, source URL/date and limitations in a
repository research matrix. Do not label a generic CSV or Alloggiati TXT as a
regional import unless the official portal accepts that exact format.

Add the correct download action to the regional tile, beginning with Lombardia
and the shared ROSS1000 XML schema. Implement separate adapters for documented
non-ROSS import formats. Where the authority requires API registration, personal
portal access or does not publish a usable import specification, show the exact
limitation and official instructions rather than inventing a format or implying
that a downloaded report completes the filing. Continue independent adapters.

Validate residence/provenance rather than guessing citizenship or birthplace.
Collect/review required capacity, occupied rooms, opening/closure days and period
before generating files; never infer occupied rooms from guest counts. Scope all
records to the active property, submitted/nondeleted/non-test guests; paginate
reads, include carry-over stays and reject invalid/group/date/code data with
useful feedback. Downloads never change Alloggiati/ISTAT filing status. No direct
regional submissions, account changes or production guest-data writes.

## Gate and release
Official example/spec-driven serializer tests plus independent parse/field checks,
all regional routing including Toscana province and property switches, boundary
stays/group IDs/unknown residence/daily availability, paginated failures and
isolation. Real Chromium IT/EN mobile/desktop: actual tile, review and downloaded
file content, errors and stale-property handling. Run affected onboarding/admin/
Share/links/environment/guest/receipt regressions and inline compilation. Publish
source, tests, source matrix, guide, plan and CHANGELOG; merge main and verify
exact hosted files/canonical configuration and deployment success. Revert source
to roll back; no automation is introduced.
