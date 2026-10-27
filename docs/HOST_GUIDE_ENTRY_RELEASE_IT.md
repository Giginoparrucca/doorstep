# Rilascio istruzioni di accesso dopo il check-in — Guida host

**Round 66.** WelcomeBnB ora può nascondere automaticamente il codice del lockbox, il codice della porta e il testo "come entrare" nell'app ospite finché tutti i check-in richiesti non sono stati completati online. L'opzione è **disattivata per impostazione predefinita**: nulla cambia per gli ospiti finché non attivi tu l'interruttore.

Questa guida spiega quando ha senso usarla, come configurarla e cosa vede l'ospite nei vari stati.

---

## Perché usarla

Alcuni host preferiscono non consegnare il codice del lockbox finché l'ospite non ha completato il check-in online (compilato i dati identificativi di ogni ospite richiesto dalla legge). Due casi tipici:

- **Più tutela legale.** Alloggiati Web (Polizia di Stato) obbliga a comunicare l'identità di ogni ospite entro 24 ore dall'arrivo. Rilasciare il codice solo dopo il check-in online riduce il rischio di soggiorni senza registrazione.
- **Più flessibilità sull'orario.** Puoi aggiungere un **orario di rilascio** sul giorno di arrivo (es: "disponibile dalle 15:00"). Anche a check-in completato, il codice resta nascosto finché non si arriva all'orario pattuito.

**Quando NON attivarla.** Se usi un meet-and-greet, o se gli ospiti ricevono il codice via messaggio diretto, l'opzione non ti serve: l'app WelcomeBnB non è il canale di consegna del codice.

---

## Come attivarla

1. Apri la **Console host** (`https://app.welcomebnb.it/host-console.html`).
2. Entra nella proprietà → scheda **Impostazioni** → tocca **Modifica**.
3. Scorri fino alla sezione **Lockbox e accesso**.
4. Attiva **"Mostra le istruzioni di accesso solo dopo il completamento del check-in"**.
5. (Facoltativo) Attiva **"Richiedi anche un orario di rilascio nel giorno di arrivo"** e scegli l'ora + il fuso orario. Il valore predefinito del fuso è `Europe/Rome`.
6. **Salva**.

Dopo il salvataggio, l'opzione vale solo per le prenotazioni future: le prenotazioni già arrivate mantengono il codice visibile se avevano già completato il check-in.

**Fuso orario.** Scegli sempre il fuso della proprietà (non quello del tuo telefono). WelcomeBnB rifiuta l'uso del fuso del browser: se vai all'estero e apri la console da un altro fuso, l'orario di rilascio della tua proprietà resta ancorato al fuso della proprietà.

---

## Cosa succede dall'app ospite

### Prima del check-in (prenotazione sincronizzata ma zero check-in completati)

L'ospite vede, al posto del codice:

> **Completa il check-in online per visualizzare le istruzioni di accesso.**

Il **Wi-Fi, l'indirizzo, il parcheggio, i consigli, il contatto host e la chat** restano visibili. Il check-in online è il percorso usuale sotto il tab "Check-in".

### Dopo il check-in, prima dell'orario (solo se hai attivato l'orario)

> **Le istruzioni di accesso saranno disponibili dalle [data] alle [ora].**

L'orario è formattato nel fuso che hai scelto nelle impostazioni. L'ora e la data sono quelle del server, non del telefono dell'ospite — un ospite che falsifica l'orologio del telefono non sblocca il codice.

### Check-in completo + orario raggiunto (o nessun orario impostato)

L'ospite vede il codice del lockbox e il testo "come entrare" come oggi. Nulla cambia rispetto al comportamento storico.

### Caso particolare: ambiguità o errore server

> **Istruzioni di accesso non disponibili. Contatta il tuo host.**

Compare quando la camera non è univocamente assegnata, quando una prenotazione è stata annullata senza che la roster venga aggiornata, o quando la lettura dei dati fallisce. Il server **fail-closed**: in caso di dubbio, il codice resta nascosto.

### Il modello di IA (Sofia)

Anche l'assistente IA della chat **conosce la policy**. Se un ospite chiede "qual è il codice del lockbox?" quando il check-in non è completo, Sofia risponde chiedendogli di completare il check-in prima e **non ripete** eventuali codici apparsi in messaggi precedenti.

---

## Come decidere se un ospite ha "completato il check-in"

Il server considera il check-in completo quando **ogni ospite richiesto** della prenotazione ha compilato il modulo. Non basta il capogruppo:

- Prenotazione da 1 persona: 1 check-in completo.
- Prenotazione da 2 persone: entrambi completi.
- Prenotazione da 4 persone con minore sotto i 14 anni: 3 completi (il minore è esente dalle norme di identificazione).
- Prenotazione standalone (senza OTA): richiede che la roster sia stata confermata dall'host dalla console. Senza roster confermata, il codice resta nascosto.

Il server consulta la roster autoritaria (OTA o roster host-confermata), **mai** il totale che l'ospite ha dichiarato nel modulo. Non puoi "ridurre" la roster facendo rimuovere un ospite al compagno.

---

## Rilascio manuale (prossimamente)

Nel prossimo rilascio aggiungeremo un pulsante **"Rilascia manualmente"** sul pannello dei dettagli della prenotazione in console. Serve per casi eccezionali: ospite senza connessione, documento rubato, minore senza accompagnatore che è stato autorizzato a soggiornare da solo.

Il rilascio manuale:
- è **tracciato in modo immutabile** con il tuo ID host, l'orario, un motivo testuale non segreto
- **non modifica il codice fisico** del lockbox: resta quello stampato
- può essere **ripristinato** (torna al rilascio automatico) con un pulsante **"Ripristina automatico"**
- **non si trasferisce** se la prenotazione viene cambiata, annullata o riassegnata — una nuova prenotazione parte sempre da "chiuso"

Per adesso, se devi forzare il rilascio su una prenotazione specifica, contattaci: `info@welcomebnb.it`.

---

## Come ripristinare il comportamento precedente

Se vuoi tornare al comportamento storico (codice sempre visibile al momento della prenotazione):

1. Console host → proprietà → Impostazioni → **Modifica**.
2. **Disattiva** "Mostra le istruzioni di accesso solo dopo il completamento del check-in".
3. **Salva**.

Ogni prenotazione, nuova e in corso, torna immediatamente a vedere il codice secondo le regole di oggi (Wi-Fi, codice fisso e rotante secondo gli altri interruttori già esistenti).

**Attenzione.** Se un ospite ha già visto il "cartello" di rilascio automatico (es: aveva ricevuto il link e aveva aperto l'app ieri), tornare indietro **non cancella la vista precedente**. L'ospite potrebbe aver già salvato il messaggio "il codice sarà disponibile dalle 15:00" nel browser. In pratica non è un problema — ricompare il codice reale al prossimo caricamento della pagina — ma vale la pena saperlo.

---

## FAQ

**Posso lasciare l'orario di rilascio ma togliere il fuso orario?**
No. Il server rifiuta la configurazione a metà: o entrambi, o nessuno dei due. Il motivo è che il fuso definito di default dal browser non è attendibile (un ospite in viaggio aprirebbe l'app in un altro fuso).

**Il codice rotante cambia con questa opzione?**
No. Il generatore di codice (`rotating_lockbox_enabled`, `use_per_guest_lockbox`, lunghezza del codice) continua a funzionare come oggi. L'opzione di Round 66 controlla solo **quando** il codice generato diventa visibile al tuo ospite — non **quale** codice.

**L'opzione copre anche il Wi-Fi e i codici camera?**
Copre: codice fisso lockbox, codice rotante, codice porta della camera (se usi camere separate), e il campo "access_method" (le istruzioni "come entrare"). Il **Wi-Fi resta sempre visibile** (non è un segreto di accesso fisico). Se hai un codice Wi-Fi nei tuoi messaggi di accesso, spostalo nel campo Wi-Fi dell'app.

**Perché il server fail-closed quando c'è un errore?**
Per sicurezza. Un errore di rete o una query lenta non deve mai rivelare un codice. Se il server non riesce a verificare lo stato della prenotazione, nasconde il codice e invita l'ospite a contattarti. È il comportamento che si prevede per prodotti sellable in due-diligence.

---

## Dettagli tecnici (per altri sviluppatori)

- Migrazione: `supabase/migrations/20261027100500_round66_entry_release_columns.sql`
- Colonne: `public.properties.entry_checkin_required bool`, `entry_release_time text (HH:MM)`, `entry_release_timezone text (IANA)`
- Policy module: `api/_entry-release-policy.js` (`evaluateEntryRelease`, `projectEntryInstructions`)
- Snapshot loader: `api/_entry-release-loader.js` (`loadEntryReleaseSnapshot`, `evaluateGuestEntryRelease`, `projectGuestEntry`, `entryReleaseAllows`)
- Handler integrazioni server-side:
  - `api/guest.js:doProperty` (campo `entry_release` nella risposta)
  - `api/guest.js:doGuestKeybox` (gate codice rotante)
  - `api/guest.js:doCheckinList` (stripping `keybox_code`)
  - `api/guest.js:doCheckinUpdate` (stripping `keybox_code`)
  - `api/chat.js` (direttiva al modello IA)
- UI host-console: `host-console.html` sezione "Lockbox e accesso"
- UI ospite: `index.html` welcome page, override di `#accessMethod`
- Test: `scripts/entry-release-policy.test.mjs` (93), `scripts/entry-release-loader.test.mjs` (19), `scripts/entry-submission-validation.test.mjs` (51), `scripts/round66-host-console-optin.test.mjs`, `scripts/round66-guest-entry-release.test.mjs`

Riferimento al piano completo: `PLAN_round66_checkin_access_release.md`.
