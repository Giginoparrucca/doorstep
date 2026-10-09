# Round 50 — Ambiente demo e onboarding host

Data: 9 ottobre 2026. Stato: pianificato; nessuna istanza demo ancora attivata.
Responsabile della specifica: GPT. Lingua della documentazione e della presentazione: italiano.

## Obiettivo e risultato atteso

Un ambiente permanente su `demo.welcomebnb.it`, con lo stesso codice dell'app,
una banca dati separata e dati esclusivamente fittizi. Serve a mostrare il percorso
ospite e il lavoro dell'host, provare le funzionalità e ripetere l'onboarding senza
alterare proprietà, prenotazioni, credenziali o statistiche reali.

La consegna comprende ambiente funzionante, dati ripristinabili, account per i
presentatori, link ospite e QR, simulazioni esplicite e la scaletta
[`docs/DEMO_ONBOARDING_IT.md`](docs/DEMO_ONBOARDING_IT.md).
La documentazione della fase 0 è una consegna distinta dalla realizzazione.

## Decisioni di architettura

- Un progetto Vercel dedicato e un progetto Supabase dedicato, entrambi demo.
  Lo stesso repository resta la fonte del codice; niente copia dell'app che diverga.
- Pubblicare nella demo soltanto revisioni approvate e registrare il commit distribuito.
  Ogni modifica allo schema ha una migrazione versionata valida per entrambi gli ambienti.
- Ricostruire lo schema corrente senza dati di produzione: tabelle, funzioni,
  trigger, RLS, grant, bucket e policy. Le vecchie migrazioni contengono anche
  operazioni manuali; non eseguirle tutte alla cieca. Preparare e verificare una
  baseline riproducibile priva di dati, segreti e scheduler di produzione.
- Mantenere autentici login, autorizzazioni, check-in, dashboard e messaggistica
  host/ospite. Simulare soltanto le azioni verso servizi esterni quando richiesto.
- `?test=1` non è l'ambiente demo: oggi esclude attività dai pannelli host e
  altera alcuni percorsi ospite. Nella banca dati demo gli scenari devono passare
  attraverso i normali filtri dell'app; distinguere le fixture con identificatori
  demo e un registro dedicato, senza cambiare la semantica di `is_test` in produzione.
- Nessun invio alla Questura, nessuna credenziale Alloggiati reale, nessun feed OTA
  reale e nessuna notifica a host o ospiti reali. Blocchi applicati sul server.
- AI e ricerca dei luoghi possono essere reali, con chiavi e limiti dedicati.
  La scheda usa luoghi reali verificabili, una posizione demo dichiarata e link
  Google Maps; nessun tempo a piedi inventato per rendere la presentazione più bella.

## Protocollo di lavoro e aggiornamento del CHANGELOG

Prima di ogni fase leggere `CHANGELOG.md` integralmente e verificare la tabella
`Current round — in-flight`. Cambiare `pending` in `in-progress — GPT` oppure
`in-progress — Claude` e creare un commit prima del lavoro della fase.

Prefisso di ogni commit: `Round 50 Phase N · `. Ogni PR riporta fase, comportamento,
verifiche e limiti. Aggiornare il CHANGELOG anche se il lavoro si interrompe:
indicare quanto è fatto, quanto manca e il prossimo passo concreto. Dopo il merge,
registrare `shipped — PR #N — <modello>` solo per una fase completamente verificata.
Una consegna parziale si chiama, per esempio, `Phase 4a`, e non chiude la fase 4.

Le regole permanenti in `AGENTS.md` si applicano anche ai Round successivi.
La tabella di Round 49 e i suoi PR restano conservati nel CHANGELOG.

## Fase 0 — Specifica e scaletta

- [ ] Registrare Round 50 e tutte le fasi nel CHANGELOG.
- [ ] Pubblicare questa specifica e la scaletta italiana per i presentatori.
- [ ] Aggiungere istruzioni permanenti di manutenzione in `AGENTS.md`.
- [ ] Verificare i link interni, il numero del Round e la distinzione tra piano e rilascio.

Accettazione: documenti nel repository e PR registrato; tutte le fasi operative
restano `pending`. Non creare infrastruttura nel solo lavoro di pianificazione.

## Fase 1 — Configurazione separata e protezioni demo

- [ ] Inventariare URL, chiavi pubbliche, fallback e integrazioni in tutte le pagine
  e API, compresi `index.html`, `host-console.html`, `admin.html`, guide, manifest,
  service worker, notifiche, inviti, email, QR e link calendario.
- [ ] Sostituire Supabase e origine app hardcoded con configurazione specifica
  dell'ambiente. Nel frontend esporre solo URL e chiave pubblica; segreti server
  esclusivamente nelle variabili Vercel. Per la stack HTML usare un file pubblico
  generato durante il deployment oppure una configurazione equivalente verificata.
- [ ] Definire `APP_ENV=demo`, origine demo, ref Supabase demo e lista di origini
  ammesse. Configurazione mancante o incoerente deve bloccare il servizio, senza
  fallback verso il progetto Supabase di produzione.
- [ ] Applicare sul server i blocchi Alloggiati, inviti, notifiche, sincronizzazione
  OTA e webhook esterni. Un parametro URL o una modifica al browser non deve
  poterli aggirare. In demo il valore predefinito dell'autofile è `off`.
- [ ] Separare chiavi AI, token ospite e altri segreti. Non copiare il Vault,
  `AUTOFILE_CRON_SECRET`, credenziali Alloggiati o destinatari della produzione.
- [ ] Mantenere CORS con origini esplicite: niente wildcard `*.vercel.app`.
- [ ] Separare cache, token e configurazione client per origine e ambiente.

Accettazione: browser e API puntano entrambi alla demo; nessun percorso demo
può leggere/scrivere in produzione o richiamare un'integrazione reale bloccata.

## Fase 2 — Provisioning e schema riproducibile

- [ ] Verificare disponibilità, piano, costi e limiti dei due progetti prima della
  creazione; registrare nomi, ID, regione, proprietario e procedura di gestione.
- [ ] Creare Supabase demo e applicare la baseline/migrazioni verificate, inclusi
  grant espliciti, RLS, funzioni e bucket privati. Nessun dump di dati reali.
- [ ] Non attivare i cron di produzione: autofile, invii email, cattura QA e purge.
  Documentare separatamente eventuali lavori di manutenzione propri della demo.
- [ ] Creare Vercel demo collegato allo stesso repository; configurare variabili,
  dominio `demo.welcomebnb.it` e DNS, poi verificare HTTPS e deployment.
- [ ] Configurare Supabase Auth con Site URL/redirect demo e accesso host tramite
  invito. Account nominali per i presentatori; credenziali fuori dal repository.
- [ ] Proteggere console e funzioni gestionali con login. L'accesso ospite deve
  restare utilizzabile da telefono tramite QR; verificare che eventuale protezione
  Vercel non blocchi questo percorso. Nessuna password condivisa pubblicamente.
- [ ] Preparare rollback della configurazione e delle migrazioni della demo.

Accettazione: login, gateway ospite e storage funzionano sulla nuova istanza;
un account di un'altra proprietà non vede i dati altrui; la produzione è invariata.

## Fase 3 — Dati fittizi e scenari

- [ ] Creare un seed versionato e ripetibile, con identificatori stabili e manifest
  dei dati gestiti. Email su domini riservati agli esempi, telefoni non operativi,
  nominativi e documenti inventati; nessun documento reale o fotografia di un ospite.
- [ ] Preparare la proprietà principale **Casa Demo WelcomeBnB**: foto autorizzate,
  descrizione, regole, Wi-Fi e codice di accesso dimostrativi, istruzioni IT/EN,
  impostazioni tassa di soggiorno dichiarate come esempio.
- [ ] Aggiungere una seconda proprietà fittizia per mostrare il cambio proprietà
  e verificare l'isolamento. Limitare i dati a quelli utili alla presentazione.
- [ ] Collegare 5–6 consigli a luoghi reali con Maps e fonti verificate, usando una
  posizione demo dichiarata. Non attribuire recensioni, orari o distanze senza fonte.
- [ ] Preparare circa 10 prenotazioni con date relative al giorno di reset.
  Allineare date OTA/check-in, notti, codici e tutti gli eventi collegati.

| Scenario stabile | Date relative | Cosa mostra |
|---|---|---|
| DEMO-ARRIVO | Arrivo domani | Prenotazione, link da condividere, istruzioni |
| DEMO-NUOVO | Arrivo oggi, nessun check-in | Percorso completo da telefono |
| DEMO-SOGGIORNO | Arrivo ieri, partenza tra 3 giorni | Dashboard e dettagli ospite |
| DEMO-AIUTO | Soggiorno in corso | Richiesta all'host e risposta in chat |
| DEMO-GRUPPO | Arrivo oggi, 3 ospiti | Capogruppo e membri, dati/documenti fittizi |
| DEMO-CONFORMITA | Arrivo ieri | Invio simulato e ricevuta dimostrativa |
| DEMO-PARTENZA | Partenza oggi | Azioni di fine soggiorno |
| DEMO-RECENTE | Partenza 3 giorni fa | Periodo recente nel pannello azioni |
| DEMO-SCADUTO | Partenza 8 giorni fa | Assenza dalla bacheca azioni |
| DEMO-NOSHOW | Partenza 8 giorni fa, nessun check-in | Assenza di richieste di check-in obsolete |

- [ ] Popolare conversazioni IT/EN, eventi analytics credibili e una richiesta di
  assistenza. Ogni storico precompilato è presentato come esempio dimostrativo.
- [ ] Creare un'immagine/documento di esempio con marcatura **FACSIMILE — DEMO**
  per il percorso scansione simulato. Non usare un'identità ufficiale valida.
- [ ] Verificare FK, vincoli, gruppi e conteggi dopo il seed; nessuna duplicazione
  dopo una seconda esecuzione.

Accettazione: tutti gli scenari sono visibili nei pannelli corretti; le prenotazioni
scadute e i no-show vecchi non compaiono nella bacheca; i dati sono solo fittizi.

## Fase 4 — Ripristino e sessioni

- [ ] Implementare **Ripristina demo**, riservato al presentatore e protetto sul
  server da autenticazione, autorizzazione e controllo del progetto demo.
  Mostrare una conferma chiara e rifiutare qualsiasi richiesta verso produzione.
- [ ] Scegliere un'implementazione compatibile con i vincoli esistenti: l'audit
  Alloggiati è immutabile e non può essere cancellato con un normale `DELETE`.
  Non indebolire grant o audit di produzione per rendere possibile il reset.
  Gestire dataset/sessioni demo nuovi oppure un ripristino amministrativo isolato,
  documentando il trattamento dei log dimostrativi.
- [ ] Ripristinare prenotazioni, check-in, chat, escalation, analytics, esclusioni,
  preferenze, cooldown notifiche, ricevute simulate e file creati durante la demo.
  Mantenere gli account nominali e le loro autorizzazioni.
- [ ] Calcolare le date relative in `Europe/Rome`; conservare durate e relazioni.
  Riportare un riepilogo di successo con data, conteggi e link aggiornati.
- [ ] Invalidare sessioni e link precedenti dove necessario; fornire un nuovo link
  ospite. Il vecchio localStorage non deve ripristinare un check-in già azzerato.
- [ ] Rendere il reset atomico o recuperabile e impedire due reset concorrenti.
- [ ] Per la prima versione usare una sola presentazione alla volta, con indicazione
  della sessione in corso. Le demo parallele richiedono dataset/host separati;
  un reset globale non deve cancellare il lavoro di un altro presentatore.

Accettazione: due onboarding consecutivi iniziano nello stesso stato funzionale;
il reset è rifiutato a un ospite e in produzione, e recupera da un errore parziale.

## Fase 5 — Esperienza demo e simulazioni

- [ ] Banner persistente **Ambiente demo — dati fittizi**, anche su telefono,
  e pagina di avvio con Apri console, Apri ospite, QR e Ripristina demo.
- [ ] QR e link generati puntano sempre alla demo, anche dopo cambio proprietà,
  reset e invio di una notifica simulata.
- [ ] Simulare scansione del facsimile con dati predefiniti, chiaramente dichiarati.
  Non invitare il nuovo host a caricare un documento personale durante l'onboarding.
- [ ] Alloggiati: simulare validazione, errore da correggere, invio e ricevuta
  **FACSIMILE — nessuna trasmissione alla Questura**. Ogni simulazione è etichettata;
  il backend non chiama SOAP, neppure se il browser prova un'azione manuale o live.
- [ ] Notifiche: registrare gli avvisi in una casella demo accessibile al presentatore.
  Eventuali email effettive devono avere destinatari autorizzati espliciti e fissi.
  Telegram e push a dispositivi reali disabilitati nella prima versione.
- [ ] Calendario OTA: mostrare prenotazioni precompilate e un feed fixture locale;
  nessuna pubblicazione o sincronizzazione con account OTA veri.
- [ ] AI: mantenere la conversazione reale e i limiti di consumo demo; fornire
  uno storico di riserva chiaramente etichettato per indisponibilità del servizio.
  Link Maps quando si consiglia un luogo; dichiarare ciò che non è verificabile.
- [ ] Aggiornare le guide interessate e la loro versione secondo il contratto
  esistente; distinguere le istruzioni demo da quelle operative reali.

Accettazione: il pubblico distingue funzioni reali e simulate senza spiegazioni
tecniche; i percorsi interattivi della scaletta funzionano e non inviano dati fuori.

## Fase 6 — Collaudo, rilascio e gestione

- [ ] Verificare URL/ref demo nei browser, API, storage e link generati; provare
  richieste manipolate e token di produzione contro la demo e viceversa.
- [ ] Provare il percorso da telefono e desktop: QR → check-in → chat AI →
  richiesta host → risposta host → polling ospite → conformità simulata → reset.
- [ ] Verificare l'assenza di chiamate SOAP, feed OTA reali, email non autorizzate,
  cron importati e scritture di produzione, osservando richieste e log.
- [ ] Verificare AI con richiesta di ristorante a piedi: Maps, posizione corretta,
  fonti per informazioni attuali e nessun tempo inventato.
- [ ] Controllare RLS/grant, chiavi pubbliche, assenza di segreti nei file distribuiti,
  limiti AI e accessibilità del percorso ospite da telefono.
- [ ] Provare il reset due volte e l'esecuzione a cavallo di giorno/mese, con date
  valide, scadenze della bacheca e stato ospite ripristinato.
- [ ] Eseguire la scaletta italiana completa in circa 15 minuti; aggiornare nomi
  dei pulsanti e link ai valori realmente rilasciati.
- [ ] Consegnare al presentatore link, accesso sicuro, procedura pre-demo,
  ripristino, soluzione alternativa e istruzioni per aggiornare la demo.
- [ ] Registrare PR, commit distribuito, verifiche, costi osservati, proprietario
  della manutenzione e rollback nel CHANGELOG. Non dichiarare pronto il Round
  se dominio, accesso o simulazioni sono ancora incompleti.

## File e configurazioni da consegnare

| Elemento | Scopo |
|---|---|
| `PLAN_round50_demo_onboarding.md` | Specifica e criteri di completamento |
| `docs/DEMO_ONBOARDING_IT.md` | Scaletta per presentatore e nuovo host |
| `AGENTS.md` + `CHANGELOG.md` | Stato, responsabilità e aggiornamento continuo |
| Baseline schema e migrazioni versionate | Ricostruzione demo senza dati reali |
| Seed/fixture e manifest demo | Ripristino di scenari e dati fittizi |
| Configurazione pubblica per ambiente | URL/chiave pubblica/frontend, senza segreti |
| Controlli server e simulazioni | Blocco integrazioni reali nella demo |
| Gestione reset e pagina di avvio | Presentazioni ripetibili |
| Verifiche di isolamento e percorso completo | Evidenze prima del rilascio |

I nomi dei nuovi file di implementazione vengono fissati nelle rispettive fasi,
dopo l'inventario della stack e dei limiti Vercel. Non aggiungere endpoint oltre
il limite del piano senza verificarlo; riusare un dispatcher quando appropriato.

## Operatività dopo il rilascio

Prima di ogni onboarding: reset, controllo rapido, nuovi link ospite e verifica
dei servizi AI. Dopo l'incontro: chiudere la sessione e ripristinare i dati.
Quando cambia una funzionalità presentata: aggiornare seed, scaletta, guide e
CHANGELOG nella stessa consegna. Prima di promuovere una nuova revisione demo,
provare migrazioni e percorso completo; conservare una versione stabile per gli incontri.

La demo non include attivazione della proprietà reale del nuovo host. Quella è un
passaggio separato, con contenuti corretti, credenziali del titolare e configurazione
operativa delle integrazioni. Le simulazioni non provano una trasmissione reale.
