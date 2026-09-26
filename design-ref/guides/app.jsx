function Note({ children }) {
  return <div className="cv-note">{children}</div>;
}

function PillBoard() {
  const states = [['default', 'Predefinito'], ['new', 'Prima visita — pulsa piano'], ['seen', 'Già vista — discreto']];
  return (
    <div className="cv-pad">
      <div className="cv-cap">Accanto al titolo di ogni pagina. Non si apre mai da solo.</div>
      {states.map(([s, l]) => (
        <div key={s} className="cv-pill-row">
          <div className="cv-pill-l">{l}</div>
          <div className="cd-title-row"><h1 className="cd-title">Dati Check-in</h1><HelpPill state={s}/></div>
        </div>
      ))}
      <div className="cv-cap" style={{marginTop:22}}>Su telefono: sotto il titolo, altezza 44 px.</div>
      <div style={{display:'flex', gap:12, flexWrap:'wrap'}}>
        {states.map(([s]) => <HelpPill key={s} state={s} mobile/>)}
      </div>
    </div>
  );
}

function FramesBoard() {
  const ids = ['ci1', 'ci2', 'ci3', 'ci4', 'qr1', 'qr2', 'qr3'];
  return (
    <div className="cv-pad">
      <div className="cv-frames">
        {ids.map((id, i) => (
          <div key={id}>
            <div className="cf-frame"><StepFrame id={id}/></div>
            <div className="cv-frame-l">{id.startsWith('ci') ? 'Check-in · passo ' + (i + 1) : 'QR · passo ' + (i - 3)}</div>
          </div>
        ))}
        <div className="cv-kit">
          <div className="cv-kit-t">Kit (7 pezzi)</div>
          <svg viewBox="0 0 320 200" style={{width:'100%', display:'block'}}>
            <rect width="320" height="200" rx="10" fill={K.bg}/>
            <Card x={14} y={14} w={80} h={50}/><Bar x={24} y={26} w={50}/><Bar x={24} y={38} w={34} h={5} c={K.t1}/>
            <Btn x={110} y={24} w={70} label="Pulsante"/>
            <Marker x={210} y={35} n={1}/>
            <Cursor x={250} y={26}/>
            <Row x={20} y={86} w={150} statusLabel="Stato"/>
            <FileIcon x={200} y={80} label=".txt"/>
            <Arrow d="M20 170 C 60 150, 100 150, 140 170" end={[142, 171, 25]}/>
            <Phone x={250} y={90} w={54} h={96}/>
            <QR x={180} y={146} s={40} c={K.t2}/>
          </svg>
          <div className="cv-frame-l">Card · Pulsante · Riga · Numero · Cursore · Freccia · Telefono (+ file, QR)</div>
        </div>
      </div>
    </div>
  );
}

function App() {
  const it = GUIDES.checkin_it, qr = GUIDES.qr_it, en = GUIDES.checkin_en;
  return (
    <DesignCanvas>
      <DCSection id="entry" title="1 · Punto d’accesso" subtitle="La pillola «? Come funziona» in tre stati">
        <DCArtboard id="pill" label="Pillola — stati" width={740} height={480}><PillBoard/></DCArtboard>
      </DCSection>

      <DCSection id="container" title="2 · Contenitore + 6 · Esempio completo" subtitle="Dati Check-in → invio alla Polizia. Desktop: pannello laterale 420 px, la pagina resta visibile. Telefono: foglio dal basso.">
        <DCArtboard id="desk" label="Desktop — pannello laterale" width={1280} height={800}>
          <ConsoleDesktop pill="seen"><div className="cd-scrim"></div><GuideDrawer g={it}/></ConsoleDesktop>
        </DCArtboard>
        <DCArtboard id="mob" label="Telefono — foglio aperto" width={390} height={844}>
          <ConsoleMobile pill="seen"><div className="cm-scrim"></div><GuideSheet g={it} top={56}/></ConsoleMobile>
        </DCArtboard>
        <DCArtboard id="mob-full" label="Telefono — guida intera (scorrimento)" width={390} height={2560}>
          <GuideSheet g={it} full/>
        </DCArtboard>
      </DCSection>

      <DCSection id="frames" title="4 · Stile dei disegni" subtitle="Disegni semplificati della pagina vera. Solo l’elemento da premere è a colori pieni.">
        <DCArtboard id="frames-b" label="7 riquadri + kit" width={1160} height={640}><FramesBoard/></DCArtboard>
      </DCSection>

      <DCSection id="spot" title="5 · «Mostrami» sulla pagina vera" subtitle="La guida si riduce, la pagina scorre al pulsante vero: anello, «Premi qui» per 4 secondi, resto oscurato. La pastiglia in basso riapre la guida allo stesso passo.">
        <DCArtboard id="spot-d" label="Desktop — riflettore" width={1280} height={800}><ConsoleDesktop spotlight/></DCArtboard>
        <DCArtboard id="spot-m1" label="Telefono — riflettore (0–4 s)" width={390} height={844}><ConsoleMobile spotlight/></DCArtboard>
        <DCArtboard id="spot-m2" label="Telefono — dopo 4 s: torna alla guida" width={390} height={844}><ConsoleMobile resume/></DCArtboard>
      </DCSection>

      <DCSection id="qr" title="7 · Esempio breve: QR Code & Link" subtitle="3 passi. Nessun «Attenzione»: non c’è obbligo, scadenza o azione irreversibile.">
        <DCArtboard id="qr-full" label="Telefono — guida intera" width={390} height={1970}><GuideSheet g={qr} full/></DCArtboard>
      </DCSection>

      <DCSection id="en" title="8 · Versione inglese" subtitle="Stessa guida, testi più lunghi o più corti: il layout regge.">
        <DCArtboard id="en-full" label="Phone — full guide (EN)" width={390} height={2670}><GuideSheet g={en} full/></DCArtboard>
      </DCSection>

      <DCSection id="sheet" title="9 · Come scrivere una guida" subtitle="Una pagina per chi aggiungerà guide in futuro">
        <DCArtboard id="ws" label="Regole di scrittura" width={860} height={1490}><WritingSheet/></DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
