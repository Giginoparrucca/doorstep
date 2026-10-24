# Provider clarification draft — Round 63 Phase 3

Prepared 24 October 2026. **Draft; not sent.** No credentials, private feed URLs,
real booking references or guest data belong in this document or its replies
committed to the public repository. Record only nonsecret contract facts in
[API_REFERENCE](API_REFERENCE.md), with the provider's reply date/source.

The uploaded API PDF/integration guide and Salvatore's correspondence remain the
source of confirmed facts. These are questions about gaps, not claims about
undocumented API behavior. The approved test read passed; a real-property pilot
and the controlled cutover have not happened.

## Ready-to-review Italian message

**Oggetto: WelcomeBnB — conferme tecniche per attivare la lettura prenotazioni**

Buongiorno Salvatore,

abbiamo verificato l'autenticazione e la lettura di camere, distributori e
prenotazioni sulla struttura di test. In WelcomeBnB sono pronti la connessione
sicura, l'associazione esplicita delle camere e un confronto in sola lettura con
il calendario esistente.

Prima di attivare l'importazione delle prenotazioni, ci servono queste conferme
per evitare duplicati e omissioni:

1. Per `POST /reservations`, `fromDate` e `toDate` selezionano gli arrivi, i
   soggiorni che si sovrappongono al periodo o le date di aggiornamento? Gli
   estremi sono inclusi? Come vengono trattati i soggiorni iniziati prima di
   `fromDate`, quelli con partenza sul limite e le prenotazioni fuori periodo?
   Quali sono il periodo predefinito e la durata massima della richiesta?
2. La risposta contiene tutte le prenotazioni corrispondenti, oppure esistono
   paginazione, un limite di righe o troncamenti? Come si riconosce in modo certo
   una risposta completa e come si recuperano eventuali altre pagine? L'ordine è
   stabile tra richieste ripetute?
3. Qual è l'ambito di unicità di `idReservation`: struttura e distributore?
   L'identificativo può essere riutilizzato? Per adottare una prenotazione già
   importata via iCal, esiste una corrispondenza documentata tra questo ID e lo
   UID della prenotazione nel feed? Un eventuale identificativo della categoria
   camera nel feed coincide con `/rooms.id`, oppure sono identificativi distinti?
4. Qual è il fuso orario di `dateTimeLastUpdate`? Il campo aumenta sempre a ogni
   modifica, anche per una cancellazione? Due versioni diverse possono avere lo
   stesso timestamp? È disponibile una revisione o un altro criterio affidabile
   per riconoscere aggiornamenti vecchi o arrivati fuori ordine?
5. Come si recuperano le cancellazioni con stato `D`? Per quanto tempo restano
   visibili e quale filtro di data viene applicato? Sono reperibili tramite
   `idReservation` e `idDistributor` anche fuori dal periodo originale? Quali
   campi rimangono valorizzati dopo la cancellazione?
6. Le voci `/rooms` di tipo `room` identificano sempre una singola unità fisica o
   possono rappresentare categorie con più unità? Come si conoscono capacità e
   disponibilità delle singole unità? Nel caso di ID ripetuti o più camere nella
   stessa prenotazione, come possiamo assegnare correttamente ogni unità senza
   duplicare ospiti, importi o prenotazioni? Come va interpretato il tipo
   `property` rispetto alle camere della stessa struttura?

Per la successiva fase disponibilità, ci confermate se esiste già un endpoint
ufficiale con documentazione? Ci servirà distinguere disponibilità zero, chiusura
esplicita e unità occupate da prenotazioni, prima di importare blocchi. Fino ad
allora questa funzione resta disabilitata. Le scritture dirette e la
sincronizzazione bidirezionale saranno una fase separata.

Sono sufficienti risposte tecniche o link alla documentazione aggiornata; non è
necessario inviare nuovamente credenziali o dati di ospiti.

Grazie,
Daniele — WelcomeBnB

## How answers unblock implementation

| Answer | Required gate |
|---|---|
| Date filters and complete listing/paging | Define bounded fetch coverage and report incomplete runs; do not infer cancellation from absence. |
| Native ID / iCal UID relation | Prove unique adoption; names, room labels and date similarity are review hints only. |
| Timestamp/revision semantics and D retention | Reject stale updates, retain cancellation tombstones and avoid resurrection. |
| Room/category/property inventory and allocations | Activate only supported physical mappings; quarantine repeated/multi-unit allocation. |
| Official availability contract | Phase 5 only; no fabricated closure endpoint or booking workaround. |

Sending this message requires Daniele's explicit instruction. This draft does
not send mail or authorize any change to the host's live calendar.
