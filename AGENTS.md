# WelcomeBnB — istruzioni permanenti per gli agenti

Queste istruzioni si applicano a tutto il repository, a Claude, GPT e agli altri
agenti che intervengono sul progetto.

## CHANGELOG e passaggio tra modelli

1. Prima di qualsiasi Round, leggere `CHANGELOG.md` dall'inizio alla fine e la
   specifica del Round. La tabella `Current round — in-flight` è la fonte dello
   stato; verificare il ramo remoto corrente prima di modificarla.
2. Prima di lavorare su una fase, cambiarla da `pending` a
   `in-progress — <modello>` e creare un commit. Non prendere una fase già
   assegnata a un altro modello senza risolvere il passaggio di responsabilità.
3. Usare commit con prefisso `Round R Phase N · `, dove R e N corrispondono al
   Round e alla fase effettivi. Per Round 49 resta `Round 49 Phase N · `.
4. Aggiornare il CHANGELOG durante il lavoro e alla fine di ogni sessione:
   modifiche, verifiche eseguite, PR, blocchi, consegne parziali e prossimo passo.
   Includere l'aggiornamento nella consegna pertinente. Non aspettare una richiesta
   separata di Daniele e non lasciare questa attività come promessa futura.
5. Dopo il merge, registrare `shipped — PR #N — <modello>` solo se tutti i criteri
   della fase sono soddisfatti. Una parte si registra come `Phase Na` con ambito
   esplicito; documentazione pronta, codice unito e ambiente operativo sono stati
   distinti. Le fasi di implementazione non sono shipped solo perché esiste un piano.
6. Conservare la cronologia dei Round precedenti e i PR dei rispettivi modelli.
   Quando si apre un nuovo Round, spostare la tabella precedente in uno storico
   visibile; non cancellarla. Non rinumerare fasi già pubblicate.
7. Se manca accesso per pubblicare o un controllo fallisce, riportarlo nel
   CHANGELOG e nel risultato finale; non inventare merge, deployment o verifiche.

## Round 50

Specifica: `PLAN_round50_demo_onboarding.md`.
Scaletta per onboarding: `docs/DEMO_ONBOARDING_IT.md`.

La fase 0 è documentale. Le fasi 1–6 realizzano e verificano la demo. Quando
cambiano comportamenti mostrati durante l'onboarding, aggiornare anche seed,
scaletta e guide interessate nella stessa consegna.

La demo usa un database separato e dati fittizi. I blocchi di integrazioni esterne
sono server-side; il reset deve rifiutare l'ambiente di produzione. Non copiare
dati, documenti, Vault o credenziali reali nella demo. Non indebolire i controlli
di produzione per consentire simulazioni o ripristino.
