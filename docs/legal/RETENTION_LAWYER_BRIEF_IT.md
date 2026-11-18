# Nota per l'avvocato — conservazione dei dati e condizioni per gli host

Preparata il 18 novembre 2026 (Round 76). È una ricerca, non un parere legale: serve a rendere rapida la revisione.

## 1. Il servizio in breve

WelcomeBnB è un'applicazione per host di affitti brevi e B&B in Italia. Gli ospiti fanno il check-in online e WelcomeBnB, su mandato dell'host, invia le schedine ad Alloggiati Web (Polizia di Stato). Prepara inoltre le esportazioni per le statistiche regionali e per l'imposta di soggiorno, e offre una chat assistita da intelligenza artificiale.

Per i dati degli ospiti l'host è titolare del trattamento e WelcomeBnB è responsabile (art. 28 GDPR). I dati sono ospitati nell'UE (Supabase, Irlanda).

Il servizio è oggi gestito da **Daniele Petrilli**, persona fisica residente fuori dall'UE, che opera con il marchio WelcomeBnB. È prevista la costituzione di una S.r.l.s. italiana.

## 2. Tempi di conservazione proposti

| Dati | Conservazione | Base |
|---|---|---|
| Ricevuta Alloggiati e registro degli invii | 5 anni dall'invio | DM Interno 7/1/2013, come modificato dal DM 16/9/2021, art. 4-bis c. 2 |
| Dati d'identità trasmessi (tipo, numero e luogo di rilascio del documento; luogo e data di nascita completa) | Cancellati appena c'è la ricevuta, o appena l'host segna l'ospite come inviato. Dove la struttura deve inviare con gli stessi dati anche le statistiche regionali (per la Puglia il tracciato «PS» di SPOT Easy), alla fine del mese successivo alla partenza | DM 2013/2021, art. 4-bis c. 2; Garante, 29/4/2026; obblighi statistici regionali |
| Foto del documento e selfie | Cancellate appena c'è la ricevuta | Garante, 29/4/2026 |
| Dati per le statistiche regionali (sesso, anno di nascita, cittadinanza, residenza) | Fino alla fine del 12° mese dopo il soggiorno, per eventuali rettifiche; poi solo dati aggregati | Obblighi statistici regionali e ISTAT; art. 5 par. 1 lett. e) GDPR |
| Dati per l'imposta di soggiorno (nome del capogruppo, date, numero di ospiti e notti, categoria e dichiarazione di esenzione) | 5 anni dopo la fine dell'anno d'imposta | Regolamenti comunali (es. Bologna, Napoli, Torino) |
| Dati di fatturazione (solo per gli ospiti che chiedono la fattura) | 10 anni | Art. 2220 c.c. |
| Prenotazioni (date, portale, nome dell'ospite) | 10 anni dal check-out | Art. 2220 c.c.; prescrizione ordinaria, art. 2946 c.c. |
| Email e telefono indicati nelle prenotazioni | 12 mesi dal check-out | Art. 5 par. 1 lett. e) GDPR |
| Consensi marketing | 24 mesi dal soggiorno; le revoche si conservano 24 mesi come prova | Garante 2005, 2020 (n. 181) e 2023 (n. 321) |
| Chat con l'ospite | 12 mesi dal soggiorno; le coppie domanda/risposta anonimizzate senza limite | Art. 5 par. 1 lett. e) GDPR |
| Registro accessi alle porte; notifiche agli host | 12 mesi | Art. 5 par. 1 lett. e) GDPR |
| Account dell'host, accettazione delle condizioni, abbonamento e pagamenti | 10 anni dalla chiusura dell'account | Artt. 2220 e 2946 c.c. |
| Registro delle azioni degli amministratori | 2 anni | Accountability, art. 5 par. 2 GDPR |

## 3. Domande

1. **Software terzo.** Il DM 2013/2021 impone alla struttura di cancellare i dati trasmessi appena generata la ricevuta. Può WelcomeBnB, come responsabile, conservare per conto dell'host i soli campi necessari alle statistiche regionali e all'imposta di soggiorno, per i tempi indicati sopra?
2. **Marketing.** 24 mesi dal soggiorno sono un tempo corretto?
3. **Prenotazioni e chat.** Sono corretti 10 anni per le prenotazioni e 12 mesi per la chat?
4. **Fornitore persona fisica residente fuori dall'UE.** Serve un rappresentante nell'UE ai sensi dell'art. 27 GDPR? Servono garanzie per i trasferimenti (artt. 44 e seguenti, ad esempio clausole contrattuali tipo) per l'accesso amministrativo dall'estero a dati che restano in Irlanda?
5. **Cessione del contratto.** Nell'art. 1.4 delle condizioni l'host acconsente in anticipo alla cessione del contratto, compreso l'Accordo sul trattamento dei dati, alla futura S.r.l.s., con efficacia dalla comunicazione via email (art. 1407 c.c.). Restano invariate condizioni e tutele, e c'è il diritto di recesso gratuito entro 30 giorni (art. 33 c. 2 lett. s) del Codice del Consumo). Questa formulazione è sufficiente, anche per gli host consumatori?
6. **Domande ancora aperte.** Restano valide le quattro domande sulle condizioni elencate in `docs/legal/README.md`.

## 4. Fonti

- [Garante, comunicato del 29/4/2026](https://www.garanteprivacy.it/home/docweb/-/docweb-display/docweb/10244195)
- [Garante, nota di chiarimento](https://www.garanteprivacy.it/web/guest/home/docweb/-/docweb-display/print/10244289)
- [DM 7/1/2013](https://questure.poliziadistato.it/statics/19/alloggiati-dm-7-1-2013.pdf?lang=it)
- [Regione Puglia](https://www.regione.puglia.it/web/turismo/-/garante-privacy-no-alla-conservazione-di-copia-dei-documenti-degli-ospiti)
- [Comune di Bologna, imposta di soggiorno](http://www.comune.bologna.it/tasse/servizi/15:13312/13321/)
- [Comune di Napoli, imposta di soggiorno](https://www.comune.napoli.it/articolo_tematico/tributi-locali/imposta-di-soggiorno/imposta-di-soggiorno-2025/)
- [Art. 2220 c.c. (Brocardi)](https://brocardi.it/codice-civile/libro-quinto/titolo-ii/capo-iii/sezione-iii/art2220.html)
- [Durata del consenso marketing (IPRights)](https://www.iprights.it/durata-del-consenso-al-marketing/)
