// Simplified console pages (desktop + mobile) used as backdrops for the drawer, sheet and spotlight.

const GUESTS = [
  ['Holmes Olivia Marie', '10/09/2026', '14/09/2026'],
  ['Reid Alexander George', '10/09/2026', '14/09/2026'],
  ['Kelly Joanna Louise', '10/09/2026', '14/09/2026'],
  ['Wheeler Jack William', '10/09/2026', '14/09/2026'],
  ['Andrew Jazmine', '10/09/2026', '14/09/2026'],
  ['Caplowe Samuel Gentle', '10/09/2026', '14/09/2026'],
];
const NAV = ['Dashboard', 'Dettagli Proprietà', 'Regole della Casa', 'Consigli', 'Dati Check-in', 'Analisi Ospiti', 'Export & Conformità', 'QR Code & Link'];

function Spot({ on, tip, children, below }) {
  if (!on) return children;
  return (
    <span className="sp-wrap">
      <span className="sp-ring">{children}</span>
      <span className={'sp-tip' + (below ? ' sp-tip-b' : '')} role="status">
        {tip}<span className="sp-timer"><span></span></span>
      </span>
    </span>
  );
}

function ResumeChip({ label, sub, mobile }) {
  return (
    <button className={'sp-resume' + (mobile ? ' sp-resume-m' : '')}>
      <span className="sp-resume-ic"><I n="book" s={20}/></span>
      <span style={{textAlign:'left'}}>
        <span className="sp-resume-s">{sub}</span>
        <span className="sp-resume-l">{label}</span>
      </span>
      <I n="up" s={20}/>
    </button>
  );
}

function ConsoleDesktop({ pill = 'default', spotlight = false, children }) {
  return (
    <div className="cd">
      <aside className="cd-sb">
        <div className="cd-logo">Welcome<em>BnB</em></div>
        <div className="cd-prop"><small>GESTIONE</small>Trullo Verde Ulivo</div>
        {NAV.map(n => <div key={n} className={'cd-nav' + (n === 'Dati Check-in' ? ' on' : '')}>{n}</div>)}
      </aside>
      <main className="cd-main">
        <div className="cd-top">
          <div>
            <div className="cd-title-row"><h1 className="cd-title">Dati Check-in</h1><HelpPill state={pill}/></div>
            <p className="cd-sub">Visualizza e gestisci le registrazioni degli ospiti</p>
          </div>
          <div className="cd-lang"><span>EN</span><span className="on">IT</span></div>
        </div>
        <div className="cd-content">
          <div className="cd-card">
            <div className="cd-card-h">
              <b>Tutti i Check-in Ospiti</b>
              <Spot on={spotlight} tip="Premi qui">
                <button className="cd-btn pri">Genera file ospiti (.txt)</button>
              </Spot>
            </div>
            <table className="cd-tbl">
              <thead><tr><th>Ospite</th><th>Arrivo</th><th>Partenza</th><th>Stato</th></tr></thead>
              <tbody>{GUESTS.map((g, i) => (
                <tr key={i}><td><b>{g[0]}</b></td><td>{g[1]}</td><td>{g[2]}</td><td><span className="cd-chip">Da inviare</span></td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      </main>
      {spotlight && <div className="sp-dim"></div>}
      {spotlight && <ResumeChip sub="Passo 2 di 4" label="Torna alla guida"/>}
      {children}
    </div>
  );
}

function ConsoleMobile({ pill = 'default', spotlight = false, dimmed = true, resume = false, children }) {
  return (
    <div className="cm">
      <div className="cm-bar">
        <span className="cm-burger"><span></span><span></span><span></span></span>
        <span className="cm-logo">Welcome<em>BnB</em></span>
        <span className="cm-lang">IT</span>
      </div>
      <div className="cm-top">
        <h1 className="cd-title">Dati Check-in</h1>
        <p className="cd-sub">Registrazioni degli ospiti</p>
        <div style={{marginTop:12}}><HelpPill state={pill} mobile/></div>
      </div>
      <div className="cm-content">
        <div className="cm-card">
          <b style={{fontSize:16}}>Tutti i Check-in Ospiti</b>
          <div style={{marginTop:12}}>
            <Spot on={spotlight && dimmed} tip="Premi qui" below>
              <button className="cd-btn pri cm-full">Genera file ospiti (.txt)</button>
            </Spot>
          </div>
        </div>
        {GUESTS.slice(0, 4).map((g, i) => (
          <div key={i} className="cm-row">
            <div><b>{g[0]}</b><div className="cm-row-s">{g[1]} → {g[2]}</div></div>
            <span className="cd-chip">Da inviare</span>
          </div>
        ))}
      </div>
      {spotlight && dimmed && <div className="sp-dim"></div>}
      {(spotlight || resume) && <ResumeChip sub="Passo 2 di 4" label="Torna alla guida" mobile/>}
      {children}
    </div>
  );
}

Object.assign(window, { ConsoleDesktop, ConsoleMobile, ResumeChip });
