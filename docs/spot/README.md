# SPOT Online official schemas

Retrieved 20 October 2026 from ARET Pugliapromozione's public SPOT page:
https://aret.regione.puglia.it/come-fare-per/dettaglio-ambito/-/asset_publisher/oE36UdluCV87/content/ambito-spot

Official specification v1.0 (13 February 2020), rechecked on 20 October 2026:
https://aret.regione.puglia.it/documents/34206/0/Spot%2Bonline%2Bspecifiche.pdf/573d004d-4a54-6f13-7c86-2560977a1304?t=1703246098453

2025 operator manual:
https://info.ect.regione.puglia.it/wp-content/uploads/2025/10/Manuale-di-utilizzo-di-SPOT-Online_2025-vers.1_09_25-1.pdf

Both official downloads begin with the invalid three-byte prefix `o;?` before
`<?xml`. Only these three bytes were removed in the committed copies; schema
constraints, enumerations, spelling and CRLF line endings are unmodified.
The normalized copies are used by lxml's XMLSchema validator in the full test suite.

XSD settles these details:
- `datistruttura` is optional structurally; we emit it on every ordinary day
  (including NM/EC) per spec section 2.2.2.3, and omit it on startup per section 2.2.2.1.
- `codiceclientesr` allows up to 100 characters; our existing stable codes fit.
- `partenzacapogrupposeparata` uses `SiNoType`: **lowercase `si`**, despite the
  uppercase SI used in the prose specification. The generated XML follows XSD.

Both ordinary and startup goldens validate against these schemas. First real
SPID-authenticated portal upload remains unverified; no portal login is automated.

## datatype-0.6.xsd

Source: https://aret.regione.puglia.it/documents/34206/114949/datatype-0.6.xsd/2f061d54-2f5d-41dd-e1fc-e19dbf13d6d0?t=1703246201988

Normalized SHA-256: `47b2d2b42196690a784c8679f80f4e7b2125b741f876c9f8f478d70041f42ba2`

## movimentogiornaliero-0.6.xsd

Source: https://aret.regione.puglia.it/documents/34206/114949/movimentogiornaliero-0.6.xsd/8884443d-5e70-e89c-787f-c2a1e6273d60?t=1703246231469

Normalized SHA-256: `44ff1e92aa7793c4367bde274ebddc58518e9de1d93fa1ae001e393de6849000`
