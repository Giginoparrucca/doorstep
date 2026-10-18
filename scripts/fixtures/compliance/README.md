# Synthetic compliance baselines

Every person, booking, document number, property and structure identifier here
is fictional. Municipality/country/document lookup codes are public reference
codes. No private golden file or production record was used.

`guests.json` deliberately places members before leaders to exercise grouping.
It contains an Italian family, a foreign-born one-night solo traveller, and a
multi-night group; primary documents cover identity card, passport and licence.
Foreign birth has eleven spaces for comune (9) and provincia (2).

`alloggiati.txt` is five ASCII records of 168 bytes separated by CRLF, without a
final newline. `paytourist.csv` is five rows of 19 columns separated by LF, also
without a final newline. The regional JSON baselines preserve filenames, MIME
types and exact contents, including padding, CRLF and the reference CSV BOM.
The selected May 1–4 period has five arrivals, one May 2 departure, four May 4
departures, and daily occupied-unit counts 3, 2, 2, 0. Regional statistics omit
guest names/documents. PS is the same fixed-width police format as Alloggiati.

Run `node scripts/golden-check.mjs` or `npm run test:all`. Tests only read
baselines; there is no automatic update mode. For an intentional format change,
review the public specification, fixture inputs and independently checked
fields, then review the changed expected bytes explicitly. A snapshot comparison
guards against drift; it does not certify a portal import or legal compliance.
