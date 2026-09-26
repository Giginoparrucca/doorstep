// Guide content + guide anatomy + containers (desktop drawer, mobile sheet) + entry pill.

const GUIDES = {
  checkin_it: {
    lang:'it', page:'Dati Check-in', title:'Inviare gli ospiti alla Polizia', time:'1 minuto',
    ui:{ how:'Come funziona', purpose:'A cosa serve', when:'Quando', steps:'I passi', step:'Passo', show:'Mostrami', faq:'Domande frequenti', useful:'Ti è stato utile?', yes:'Sì', no:'No', doubt:'Hai ancora un dubbio?', contact:'Scrivici', close:'Chiudi' },
    purpose:'Qui vedi gli ospiti registrati e prepari il file da mandare alla Polizia (Alloggiati Web).',
    when:'Entro 24 ore dall’arrivo di ogni ospite.',
    steps:[
      { f:'ci1', t:'Quando un ospite finisce il check-in online, lo trovi in questa lista.' },
      { f:'ci2', t:'Premi «Genera file ospiti». Il file si salva sul tuo telefono o computer.' },
      { f:'ci3', t:'Apri il sito Alloggiati Web, entra con i tuoi dati e invia il file.' },
      { f:'ci4', t:'Torna qui e premi «Segna inviato». L’ospite diventa verde.' },
    ],
    warn:{ label:'Attenzione', t:'L’invio alla Polizia è obbligatorio per legge. WelcomeBnB prepara il file, ma a inviarlo sei tu.' },
    tip:{ label:'Suggerimento', t:'Fai l’invio ogni giorno alla stessa ora. Così non te ne dimentichi.' },
    faq:[
      { q:'Un ospite non compare nella lista', a:'L’ospite non ha ancora finito il check-in. Vai su «Oggi» e premi «Invia link» per mandarglielo di nuovo.' },
      { q:'Il sito Alloggiati Web rifiuta il file', a:'Di solito c’è un dato sbagliato, per esempio una data di nascita. Premi sull’ospite, correggi il dato e genera di nuovo il file.' },
      { q:'Ho sbagliato: posso annullare?', a:'Sì, ma solo nello stesso giorno dell’invio, dal sito Alloggiati Web. Poi torna qui, premi «Segna da inviare» e ripeti i passi.' },
    ],
  },
  checkin_en: {
    lang:'en', page:'Check-in data', title:'Sending your guests to the Police', time:'1 minute',
    ui:{ how:'How it works', purpose:'What it’s for', when:'When', steps:'The steps', step:'Step', show:'Show me', faq:'Common questions', useful:'Was this helpful?', yes:'Yes', no:'No', doubt:'Still unsure?', contact:'Write to us', close:'Close' },
    purpose:'Here you see your registered guests and prepare the file to send to the Police (Alloggiati Web).',
    when:'Within 24 hours of each guest’s arrival.',
    steps:[
      { f:'ci1', t:'When a guest finishes online check-in, they appear in this list.' },
      { f:'ci2', t:'Press “Generate guest file”. The file is saved on your phone or computer.' },
      { f:'ci3', t:'Open the Alloggiati Web site, sign in with your details and send the file.' },
      { f:'ci4', t:'Come back here and press “Mark as sent”. The guest turns green.' },
    ],
    warn:{ label:'Important', t:'Sending guest details to the Police is required by Italian law. WelcomeBnB prepares the file, but you are the one who sends it.' },
    tip:{ label:'Tip', t:'Send the file at the same time every day, so you never forget.' },
    faq:[
      { q:'A guest is missing from the list', a:'The guest hasn’t finished check-in yet. Go to “Today” and press “Send link” to send it again.' },
      { q:'Alloggiati Web rejects the file', a:'Usually one detail is wrong, such as a date of birth. Press the guest, fix the detail and generate the file again.' },
      { q:'I made a mistake — can I undo it?', a:'Yes, but only on the same day you sent it, from the Alloggiati Web site. Then come back, press “Mark as not sent” and repeat the steps.' },
    ],
  },
  qr_it: {
    lang:'it', page:'QR Code & Link', title:'Dare il link agli ospiti', time:'1 minuto',
    ui:{ how:'Come funziona', purpose:'A cosa serve', when:'Quando', steps:'I passi', step:'Passo', show:'Mostrami', faq:'Domande frequenti', useful:'Ti è stato utile?', yes:'Sì', no:'No', doubt:'Hai ancora un dubbio?', contact:'Scrivici', close:'Chiudi' },
    purpose:'Qui trovi il link e il QR code che aprono l’app per i tuoi ospiti.',
    when:'Appena ricevi una prenotazione.',
    steps:[
      { f:'qr1', t:'Premi «Copia link». Il link è pronto da incollare.' },
      { f:'qr2', t:'Apri la chat con l’ospite, incolla il link e premi invia.' },
      { f:'qr3', t:'Premi «Stampa QR» e appendi il foglio in casa, vicino alla porta.' },
    ],
    tip:{ label:'Suggerimento', t:'Il link è sempre lo stesso: puoi salvarlo tra i messaggi rapidi di Airbnb.' },
    faq:[
      { q:'Il link è diverso per ogni ospite?', a:'No. È un solo link per la tua casa. L’ospite inserisce il suo codice prenotazione.' },
      { q:'L’ospite dice che il link non si apre', a:'Chiedigli di aprirlo con il browser del telefono, non dentro l’app di Airbnb.' },
    ],
  },
};

const Ico = {
  q:    <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>,
  clock:<g><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></g>,
  x:    <path d="M6 6l12 12M18 6L6 18"/>,
  eye:  <g><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></g>,
  warn: <g><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></g>,
  bulb: <g><path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V16h8v-1.3A7 7 0 0 0 12 2z"/></g>,
  down: <path d="M6 9l6 6 6-6"/>,
  up:   <path d="M18 15l-6-6-6 6"/>,
  thumbUp:<g><path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3z"/><path d="M7 10l4-8a3 3 0 0 1 3 3v4h5.5a2 2 0 0 1 2 2.3l-1.3 8a2 2 0 0 1-2 1.7H7"/></g>,
  thumbDn:<g><path d="M17 14V3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-3z"/><path d="M17 14l-4 8a3 3 0 0 1-3-3v-4H4.5a2 2 0 0 1-2-2.3l1.3-8A2 2 0 0 1 5.8 3H17"/></g>,
  mail: <g><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></g>,
  book: <g><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z"/><path d="M20 17v4H6.5A2.5 2.5 0 0 1 4 18.5"/></g>,
};
function I({ n, s = 20, w = 1.8, c = 'currentColor' }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{Ico[n]}</svg>;
}

// ── Entry pill ─────────────────────────────────────────────
function HelpPill({ state = 'default', lang = 'it', mobile = false }) {
  const txt = lang === 'it'
    ? { default:'Come funziona', new:'Nuovo? Guida da 1 minuto', seen:'Come funziona' }
    : { default:'How it works', new:'New? 1-minute guide', seen:'How it works' };
  return (
    <button className={'cf-pill cf-' + state + (mobile ? ' cf-m' : '')}>
      <span className="cf-q"><I n="q" s={16} w={2.2}/></span>
      <span>{txt[state]}</span>
    </button>
  );
}

// ── Guide anatomy ──────────────────────────────────────────
function GuideBody({ g, openFaq = 0, activeStep = null, mobile }) {
  const [open, setOpen] = React.useState(openFaq);
  const u = g.ui;
  return (
    <div className={'cf-body' + (mobile ? ' cf-body-m' : '')}>
      <section className="cf-block">
        <div className="cf-label">{u.purpose}</div>
        <p className="cf-purpose">{g.purpose}</p>
      </section>
      <section className="cf-when">
        <I n="clock" s={22}/>
        <div><div className="cf-label" style={{marginBottom:2}}>{u.when}</div><div className="cf-when-t">{g.when}</div></div>
      </section>
      <section className="cf-steps">
        {g.steps.map((s, i) => (
          <div key={i} className={'cf-step' + (activeStep === i ? ' cf-step-on' : '')}>
            <div className="cf-frame"><StepFrame id={s.f} lang={g.lang}/></div>
            <div className="cf-step-row">
              <span className="cf-num">{i + 1}</span>
              <p className="cf-step-t">{s.t}</p>
            </div>
            <button className="cf-show"><I n="eye" s={18}/>{u.show}</button>
          </div>
        ))}
      </section>
      {g.warn && (
        <section className="cf-call cf-warn" role="note">
          <span className="cf-call-ic"><I n="warn" s={22}/></span>
          <div><div className="cf-call-l">{g.warn.label}</div><p>{g.warn.t}</p></div>
        </section>
      )}
      {g.tip && (
        <section className="cf-call cf-tip" role="note">
          <span className="cf-call-ic"><I n="bulb" s={22}/></span>
          <div><div className="cf-call-l">{g.tip.label}</div><p>{g.tip.t}</p></div>
        </section>
      )}
      <section>
        <h3 className="cf-h3">{u.faq}</h3>
        <div className="cf-faq">
          {g.faq.map((f, i) => (
            <div key={i} className={'cf-q-item' + (open === i ? ' on' : '')}>
              <button className="cf-q-btn" onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i}>
                <span>{f.q}</span><I n={open === i ? 'up' : 'down'} s={20}/>
              </button>
              {open === i && <p className="cf-a">{f.a}</p>}
            </div>
          ))}
        </div>
      </section>
      <footer className="cf-foot">
        <div className="cf-useful">
          <span>{u.useful}</span>
          <div style={{display:'flex', gap:8}}>
            <button className="cf-vote"><I n="thumbUp" s={18}/>{u.yes}</button>
            <button className="cf-vote"><I n="thumbDn" s={18}/>{u.no}</button>
          </div>
        </div>
        <div className="cf-help">
          <span>{u.doubt}</span>
          <button className="cf-contact"><I n="mail" s={18}/>{u.contact}</button>
        </div>
      </footer>
    </div>
  );
}

function GuideHead({ g, mobile }) {
  return (
    <header className={'cf-head' + (mobile ? ' cf-head-m' : '')}>
      <div style={{flex:1, minWidth:0}}>
        <div className="cf-eyebrow"><I n="book" s={16}/>{g.ui.how} · {g.page}</div>
        <h2 className="cf-title">{g.title}</h2>
        <span className="cf-time"><I n="clock" s={15}/>{g.time}</span>
      </div>
      <button className="cf-close" aria-label={g.ui.close}><I n="x" s={22} w={2}/></button>
    </header>
  );
}

function GuideDrawer({ g }) {
  return (
    <aside className="cf-drawer" aria-label={g.title}>
      <GuideHead g={g}/>
      <div className="cf-scroll"><GuideBody g={g}/></div>
    </aside>
  );
}

function GuideSheet({ g, full = false, top = 64 }) {
  return (
    <aside className={'cf-sheet' + (full ? ' cf-sheet-full' : '')} style={full ? null : { top }} aria-label={g.title}>
      <div className="cf-handle"></div>
      <GuideHead g={g} mobile/>
      <div className={full ? '' : 'cf-scroll'}><GuideBody g={g} mobile/></div>
    </aside>
  );
}

Object.assign(window, { GUIDES, I, HelpPill, GuideBody, GuideHead, GuideDrawer, GuideSheet });
