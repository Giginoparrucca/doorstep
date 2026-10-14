# Regional statistical downloads — source register

Researched 14 October 2026. Import formats are separate from Alloggiati and from
municipal tourist-tax returns. Downloading a file never proves that it was filed.
No regional credentials or guest data were used to research/test these adapters.

## Regional routing

| Region / province | Official system | Download in WelcomeBnB | Evidence / limitation |
|---|---|---|---|
| Abruzzo | ROSS1000 / Turismo5 | ROSS1000 XML | Shared current GIES schema [1], endpoint listed |
| Basilicata | SIST / ROSS1000 | ROSS1000 XML | [1], [3] documents TXT/XML imports; WS version differs, irrelevant to file-only export |
| Campania | Sinfonia Turismo SMART | Manual-entry reference CSV | Official API procedure [19]; no verified standalone file schema retrieved |
| Calabria | SIRDAT / ROSS1000 | ROSS1000 XML | [1], endpoint listed |
| Emilia-Romagna | ROSS1000 | ROSS1000 XML | [1], [4] explicitly documents XML imports |
| Lazio | ROSS1000 | ROSS1000 XML | [1], endpoint listed; do not export old RADAR C59 |
| Liguria | ROSS1000 | ROSS1000 XML | [1], endpoint listed |
| Lombardia | ROSS1000 | ROSS1000 XML | [1], regional manual [2] documents Check-in → Importa file gestionale |
| Marche | Istrice / ROSS1000 | ROSS1000 XML | [1], [5] explicitly documents XML imports; do not export legacy Istrice2 |
| Molise | ROSS1000 | ROSS1000 XML | [1], endpoint listed |
| Piemonte | Piemonte Dati Turismo / ROSS1000 | ROSS1000 XML | [1], [6] documents import |
| Sardegna | SIRED / ROSS1000 | ROSS1000 XML | [1], [7] documents XML/TXT and PMS integration |
| Veneto | ROSS1000 | ROSS1000 XML | [1], [8] links current GIES specification |
| Toscana: Firenze, Prato, Pistoia | ROSS1000 | ROSS1000 XML | [1] lists precisely these provinces; not all Toscana |
| Toscana: other provinces / unresolved city | MOTouristOffice / assigned local system | Manual-entry reference CSV | [9], [10]; assigned system varies. No verified public standalone import schema retrieved; no invented ROSS1000 file |
| Puglia: tourist rentals using SPOT Easy | SPOT Easy | PS / Alloggiati TXT | Official 2025 manual [11] pp. 3, 15, 19–20: enable Carica file PS, then add residence and confirm after import. Export covers selected arrival dates, includes already-filed police records |
| Puglia: SPOT Online / Completo | SPOT | Manual-entry reference CSV | Different XML interface, not the SPOT Easy PS file; [11] distinguishes services. Public exact current XML specification not retrieved |
| Umbria | Turismatica | One ASCII C/59 TXT per day (ZIP for multiple days) | [12] links exact record layout, example and provenance codes. Italian provenance is residence province; foreign provenance uses regional country/aggregation codes |
| Trentino: licensed accommodation using STU | STU | One daily C59 TXT on movement days (ZIP for multiple days) | [13] technical manual: IDOBJ+DDMMYYYY.txt, leading comma/header, provincial TARGA codes. Province requires PMS congruence checks/approval: verify with APT before using importer. Does not imply WelcomeBnB accreditation |
| Trentino: DTU Alloggi private rentals | DTU Alloggi | Manual-entry reference CSV | [14] distinguishes DTU/STU. No verified DTU file-import schema retrieved; STU TXT must not be presented as DTU format |
| Alto Adige | ASTAT / LTS | Manual-entry reference CSV | 2026 official guidelines [15] explicitly require hotel software to use LTS PMS API, or operators to use Touristmanager/TM Light. CSV is not an ASTAT import or a substitute for those systems |
| Valle d’Aosta | VIT Albergatori / Locazioni turistiche | Manual-entry reference CSV | [16] documents manual entry or integrated PMS; not a documented arbitrary file upload. VIT and tourist-rental portal are distinct; both links supplied |
| Friuli-Venezia Giulia | WebTur | Manual-entry reference CSV | Official portal [17] offers file-loading video, but no public field-level current import specification found. Do not infer its schema from another region |
| Sicilia | Osservatorio / Turist@t | Manual-entry reference CSV | Official FAQ [18] points PMS vendors to a technical document; current public documents page returned zero documents. Public API landing page exists. No verified downloadable-import schema retrieved |

Reference CSV is explicitly labelled **not a portal import** in UI and file header.
It groups actual individual guests by country/province of residence, with daily
arrivals, departures, guest nights and host-reviewed availability. It contains no
names, documents or contact details. These reference downloads are partial support,
not native integration for the listed systems. File-import support for WebTur,
Sicilia, SPOT XML and non-ROSS Toscana needs the authority's current specification.
External provider approval/connectivity is outside this file-download release.

## Serializer rules

ROSS1000 uses the vendor's current XML v3, 18 March 2026 [1]. Keep the established
Veneto stable ID algorithm, detect collisions rather than changing identities.
Validate group leaders instead of matching unrelated people by arrival date.
No citizenship-to-residence or birthplace-to-residence fallback. Ambiguous Italian
municipality names require a province suffix or a verified municipality code. Foreign residence
locality is optional; Italian residence comune is mandatory. No document fields or
names are sent in this statistical XML; the official example omits names. Include
arrivals/departures only on their actual day; carry-over nights affect occupancy,
not new arrivals. A carry-over departure assumes its original arrival is already
recorded on the portal; the UI must instruct hosts to include missing earlier dates.

Opening, available units/beds and occupied units are explicitly reviewed. Never
calculate occupied rooms from guest count, never silently mark all days open,
and do not generate future-day occupancy. Closed days have zero availability and
occupancy. Missing submitted check-ins remain visible as a completeness limitation.
The host can exclude no-shows/cancelled records from the download without changing
source records. Capacity and residence changes in the review are download-only.

Umbria fixed columns follow [12]: totals start at column 28; occupied rooms at
17; date at 31; provenance code/name/arrival/departure at 1/7/43/49. Two blank
separator lines and CRLF. Provenance labels/codes come from the published table;
unknown foreign aggregation must be chosen explicitly, never guessed. Trento uses
its own TARGA codes, including the literal asterisk prefixes in the source table
(e.g. *CH Switzerland versus CH Chieti). STU generates only days with movements;
opening/closure changes remain a separate portal/APT operation.

## Sources

1. GIES current XML v3 (18/03/2026), including endpoint/region list: https://www.ross1000.it/source/tracciato-xml.pdf ; vendor entry point: https://www.ross1000.it/it/tracciati.php
2. Lombardia official manual, Importa file gestionale p.27: https://www.regione.lombardia.it/content/dam/rl/canali-tematici-servizi/07-cultura-turismo-e-sport/07-imprese-turistiche/informazioni-importanti-per-avvio-struttura-ricettiva/MANUALE%2BROSS1000%2B-%2BPROFILO%2BSTRUTTURA%2BRICETTIVA%2B%28versione%2B10_2023%29.pdf
3. APT Basilicata official SIST manual: https://www.aptbasilicata.it/wp-content/uploads/2024/12/Manuale-duso-del-SIST.pdf
4. Emilia-Romagna official documentation: https://statistica.regione.emilia-romagna.it/metadati/rilevazioni/turismo/allegati-rilevazioni-turismo/manuali-e-tracciati-rilevazioni-turismo
5. Marche official import manual: https://static.regione.marche.it/portals/0/Turismo%20Sport%20Tempo%20Libero/Turismo/Osservatorio/manuali_ross1000/Marche_MANUALE_IMPORTA%20FILE%20GESTIONALE.pdf
6. Piemonte official import manual: https://servizi.regione.piemonte.it/media/561/download?attachment=
7. Sardegna official PMS alignment: https://operatori.sardegnaturismo.it/it/allineamento-ross-1000-e-programma-gestionale-pms
8. Veneto official source page: https://www.regione.veneto.it/web/turismo/rilevazione-flussi-turistici-ross1000
9. Official Toscana portal: https://toscana.motouristoffice.it/
10. Comune Fivizzano 2026 change notice: https://www.comune.fivizzano.ms.it/novita/comunicati_stampa/novita_252.html
11. Puglia official SPOT Easy manual September 2025: https://info.ect.regione.puglia.it/wp-content/uploads/2025/10/Manuale-di-utilizzo-di-SPOT-Easy_2025-vers.1_09_25.pdf
12. Umbria official source page with linked record layout, TXT example and provenance table: https://www.regione.umbria.it/turismo-attivita-sportive/turismatica-online ; record layout: https://www.regione.umbria.it/documents/18/284970/TracciatoFileC59_con_camere.pdf/89768976-adb4-43c9-a9ba-219f640bd4b2 ; provenance table: https://www.regione.umbria.it/documents/18/284970/NTO%2Bcodici%2Bdescrizione%2Bprovenienze/66c3cab9-64c3-4326-bfdd-8321d670643c
13. Trento official technical documents: https://www.provincia.tn.it/Amministrazione/Documenti/Manuale-e-documentazione ; file manual: https://www.provincia.tn.it/content/download/24301/440112/file/Manuale%2Bcollegamento%2BSistema%2BInformativo%2Bdel%2BTurismo.pdf ; provenance TARGA table: linked “Tabelle province ISTAT”. Current page links this older file manual; no newer public file spec identified.
14. Trento service/category distinction and PMS approval: https://www.provincia.tn.it/Servizi/Comunicare-online-le-presenze-degli-ospiti-a-ISTAT-e-Pubblica-Sicurezza ; https://www.provincia.tn.it/Servizi/Movimento-dei-turisti-in-strutture-ricettive-con-licenza-dichiarazione-Istat
15. ASTAT 2026 guidelines v4 21/05/2026 linked from https://astat.provincia.bz.it/it/turismo ; PMS submission is LTS API-only.
16. VIT official manual: https://www.regione.vda.it/gestione/vit_albergatori/Docs/VIT%20Albergatori%20Manuale%20utente.pdf ; rentals portal: https://locazionituristiche.regione.vda.it/
17. Official WebTur login/training page: https://servizistatistici.regione.fvg.it/webtur/jsp/wt/login_video.jsp ; login confirms digital identity access and separate file-loading video. No authenticated operator surface was accessed.
18. Sicilia official FAQ: https://osservatorioturistico.regione.sicilia.it/public/info ; current document list https://osservatorioturistico.regione.sicilia.it/public/documents returned 0 documents; public API landing https://osservatorioturistico.regione.sicilia.it/webapi . No authenticated records or endpoints used.
19. Campania official API procedure: https://www.regione.campania.it/assets/documents/modalita-operative-per-la-trasmissione-della-movimentazione-turistica-via-web-api-tramite-software-gestionali.pdf ; current public user-guide link returned 404. No verified standalone import format retrieved.
