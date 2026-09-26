// One-page "Come scrivere una guida" sheet.

function WritingSheet() {
  const avoid = [
    ['export / esporta', 'scarica, prepara il file'],
    ['upload / caricare sul portale', 'invia il file'],
    ['tracciato, record', 'file, dati dell’ospite'],
    ['dashboard', 'la pagina «Oggi»'],
    ['login, account', 'entra, i tuoi dati'],
    ['cliccare, selezionare', 'premi, scegli'],
    ['sincronizzare', 'aggiornare'],
    ['form, campo', 'modulo, riga'],
  ];
  return (
    <div className="ws">
      <div className="ws-eyebrow">Regole per chi scrive le guide</div>
      <h1 className="ws-h1">Come scrivere una guida «Come funziona»</h1>
      <p className="ws-lead">Scrivi per una persona di 65 anni, sul telefono, preoccupata di sbagliare con la Polizia. Se deve rileggere una frase, la frase è sbagliata.</p>

      <div className="ws-grid">
        <section className="ws-box">
          <div className="ws-n">1</div>
          <h2>Lunghezza</h2>
          <ul>
            <li><b>Massimo 15 parole</b> per passo.</li>
            <li><b>Da 3 a 5 passi.</b> Se servono di più, sono due guide.</li>
            <li><b>Una sola idea</b> per frase.</li>
            <li>«A cosa serve»: una frase. «Quando»: una riga.</li>
            <li>Domande frequenti: 2 o 3, prese da domande vere.</li>
          </ul>
        </section>
        <section className="ws-box">
          <div className="ws-n">2</div>
          <h2>Voce</h2>
          <ul>
            <li>Dai del <b>tu</b>. Sempre.</li>
            <li>Inizia il passo con un verbo: <b>premi, apri, scrivi, scegli, torna, copia, incolla, stampa</b>.</li>
            <li>Chiama i pulsanti con il loro nome esatto, tra «caporali».</li>
            <li>Di’ cosa succede dopo: «L’ospite diventa verde.»</li>
            <li>Calmo, non allegro. Niente punti esclamativi.</li>
          </ul>
        </section>
      </div>

      <section className="ws-box" style={{marginTop:16}}>
        <div className="ws-n">3</div>
        <h2>Parole da evitare</h2>
        <table className="ws-tbl">
          <thead><tr><th>Non scrivere</th><th>Scrivi invece</th></tr></thead>
          <tbody>{avoid.map(a => <tr key={a[0]}><td className="ws-no">{a[0]}</td><td>{a[1]}</td></tr>)}</tbody>
        </table>
      </section>

      <div className="ws-grid" style={{marginTop:16}}>
        <section className="ws-box ws-warnbox">
          <div className="ws-n">4</div>
          <h2>Quando usare «Attenzione»</h2>
          <p>Solo se almeno una di queste è vera:</p>
          <ul>
            <li>è un <b>obbligo di legge</b>;</li>
            <li>c’è una <b>scadenza</b>;</li>
            <li>l’azione <b>non si può annullare</b>.</li>
          </ul>
          <p><b>Al massimo uno per guida.</b> Se tutto è importante, niente lo è. Consigli utili vanno in «Suggerimento».</p>
        </section>
        <section className="ws-box">
          <div className="ws-n">5</div>
          <h2>Disegni</h2>
          <ul>
            <li><b>Al massimo 3 colori:</b> azzurri neutri, blu <code>#005BFF</code>, e un solo colore di stato (verde) se serve.</li>
            <li>Un solo elemento a colori pieni: quello da premere.</li>
            <li>Un numero, un cursore o una freccia. Mai tutti e tre sparsi.</li>
            <li>Barre grigie al posto del testo. Le parole nei pulsanti sono testo separato, traducibile.</li>
            <li>Formato 16:10. Leggibile a 350 px di larghezza.</li>
          </ul>
        </section>
      </div>

      <section className="ws-check">
        <b>Prova finale:</b> leggi la guida ad alta voce a qualcuno che non conosce l’app. Se ti fa una domanda, la risposta va nella guida.
      </section>
    </div>
  );
}

window.WritingSheet = WritingSheet;
