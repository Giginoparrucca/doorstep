// Step frames built only from the kit. L = translatable label set.

const FRAME_LABELS = {
  it: { nuovo:'Nuovo', genera:'Genera file ospiti', portal:'Alloggiati Web', invia:'Invia file', segna:'Segna inviato', inviato:'✓ Inviato', copia:'Copia link', invio:'Invia', stampa:'Stampa QR', txt:'.txt' },
  en: { nuovo:'New', genera:'Generate guest file', portal:'Alloggiati Web', invia:'Send file', segna:'Mark as sent', inviato:'✓ Sent', copia:'Copy link', invio:'Send', stampa:'Print QR', txt:'.txt' },
};

function GuestList({ hiFirst, faded, statusFirst, statusLabel, badge }) {
  return (
    <g>
      <Card x={20} y={42} w={280} h={146}/>
      <Bar x={34} y={56} w={80} h={7}/>
      <Row x={36} y={78} w={248} hi={hiFirst} status={statusFirst} statusLabel={statusLabel || badge}/>
      <Row x={36} y={112} w={248} faded={faded}/>
      <Row x={36} y={146} w={248} faded={faded}/>
    </g>
  );
}

const FRAMES = {
  // Check-in → Polizia
  ci1: (L) => (
    <IFrame title="Lista ospiti con nuovo ospite evidenziato">
      <Page/>
      <GuestList hiFirst faded badge={L.nuovo}/>
      <Marker x={22} y={89} n={1}/>
    </IFrame>
  ),
  ci2: (L) => (
    <IFrame title="Pulsante genera file">
      <Page/>
      <Card x={20} y={42} w={280} h={146}/>
      <Bar x={34} y={56} w={70} h={7}/>
      <Btn x={164} y={50} w={124} label={L.genera}/>
      <g opacity="0.5">
        <Row x={36} y={90} w={130}/><Row x={36} y={124} w={130}/><Row x={36} y={158} w={130}/>
      </g>
      <Arrow d="M236 78 C 240 96, 244 104, 244 116" end={[244, 120, 90]}/>
      <FileIcon x={228} y={124} label={L.txt}/>
      <Cursor x={266} y={64}/>
      <Marker x={164} y={50} n={2}/>
    </IFrame>
  ),
  ci3: (L) => (
    <IFrame title="Sito Alloggiati Web con area di invio">
      <rect x="20" y="14" width="280" height="176" rx="8" fill={K.white} stroke={K.line}/>
      <path d="M20 22 a8 8 0 0 1 8 -8 h264 a8 8 0 0 1 8 8 v14 h-280 z" fill={K.t1}/>
      <circle cx="34" cy="25" r="3" fill={K.t2}/><circle cx="44" cy="25" r="3" fill={K.t2}/><circle cx="54" cy="25" r="3" fill={K.t2}/>
      <text x="160" y="28.5" textAnchor="middle" fontFamily={K.font} fontSize="10" fontWeight="600" fill={K.soft}>{L.portal}</text>
      <Bar x={40} y={50} w={90} h={7}/><Bar x={40} y={62} w={140} h={5} c={K.t1}/>
      <rect x="40" y="78" width="240" height="68" rx="8" fill={K.bg} stroke={K.blue} strokeWidth="1.8" strokeDasharray="5 4"/>
      <FileIcon x={144} y={90} label={L.txt}/>
      <Btn x={196} y={156} w={84} label={L.invia}/>
      <Cursor x={250} y={170}/>
      <Marker x={40} y={78} n={3}/>
    </IFrame>
  ),
  ci4: (L) => (
    <IFrame title="Ospite segnato come inviato, in verde">
      <Page/>
      <Card x={20} y={42} w={280} h={146}/>
      <Bar x={34} y={56} w={70} h={7}/>
      <Btn x={196} y={50} w={92} label={L.segna}/>
      <Row x={36} y={84} w={248} status="green" statusLabel={L.inviato}/>
      <Row x={36} y={118} w={248} status="green" statusLabel={L.inviato}/>
      <g opacity="0.5"><Row x={36} y={152} w={248}/></g>
      <Cursor x={250} y={64}/>
      <Marker x={196} y={50} n={4}/>
    </IFrame>
  ),

  // QR Code & Link
  qr1: (L) => (
    <IFrame title="Copia il link">
      <Page/>
      <Card x={20} y={42} w={280} h={146}/>
      <rect x="38" y="60" width="72" height="72" rx="6" fill={K.bg} stroke={K.line}/>
      <QR x={46} y={68} s={56} c={K.t2}/>
      <rect x="126" y="64" width="158" height="26" rx="6" fill={K.bg} stroke={K.line}/>
      <Bar x={136} y={74} w={110}/>
      <Btn x={126} y={100} w={90} h={26} label={L.copia}/>
      <Bar x={38} y={150} w={200} h={5} c={K.t1}/><Bar x={38} y={162} w={150} h={5} c={K.t1}/>
      <Cursor x={196} y={116}/>
      <Marker x={126} y={100} n={1}/>
    </IFrame>
  ),
  qr2: (L) => (
    <IFrame title="Manda il link all'ospite in chat">
      <Phone x={102} y={10} w={116} h={184}>
        <rect x="110" y="24" width="100" height="18" rx="4" fill={K.t1}/>
        <circle cx="120" cy="33" r="5" fill={K.t2}/><Bar x={130} y={30} w={40} h={5}/>
        <rect x="112" y="52" width="64" height="22" rx="8" fill={K.t1}/><Bar x={119} y={60} w={44} h={5} c={K.t2}/>
        <rect x="132" y="84" width="76" height="40" rx="8" fill={K.blue}/>
        <Bar x={140} y={93} w={56} h={5} c="rgba(255,255,255,0.55)"/>
        <rect x="140" y="103" width="60" height="13" rx="4" fill="rgba(255,255,255,0.22)"/>
        <Bar x={145} y={107} w={40} h={5} c={K.white}/>
        <rect x="110" y="166" width="72" height="20" rx="10" fill={K.bg} stroke={K.line}/>
        <circle cx="198" cy="176" r="10" fill={K.blue}/>
        <path d="M194 176 h8 M199 172 l4 4 -4 4" stroke={K.white} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      </Phone>
      <text x="240" y="180" fontFamily={K.font} fontSize="10.5" fontWeight="700" fill={K.blue}>{L.invio}</text>
      <Arrow d="M236 176 C 226 176, 220 176, 212 176" end={[210, 176, 180]}/>
      <Marker x={132} y={84} n={2}/>
    </IFrame>
  ),
  qr3: (L) => (
    <IFrame title="Stampa il QR e mettilo in casa">
      <path d="M40 190 V70 l60 -40 l60 40 V190 z" fill={K.t1}/>
      <rect x="84" y="120" width="32" height="70" rx="3" fill={K.t2}/>
      <g transform="rotate(-3 222 108)">
        <rect x="170" y="40" width="104" height="136" rx="4" fill={K.white} stroke={K.line}/>
        <Bar x={186} y={54} w={60} h={6}/>
        <QR x={190} y={70} s={64} c={K.blue}/>
        <Bar x={186} y={148} w={72} h={5} c={K.t1}/><Bar x={186} y={158} w={50} h={5} c={K.t1}/>
      </g>
      <Btn x={20} y={16} w={80} label={L.stampa}/>
      <Arrow d="M100 27 C 140 27, 160 30, 172 44" end={[174, 47, 50]}/>
      <Marker x={170} y={40} n={3}/>
    </IFrame>
  ),
};

function StepFrame({ id, lang = 'it' }) {
  return FRAMES[id](FRAME_LABELS[lang]);
}

Object.assign(window, { FRAMES, FRAME_LABELS, StepFrame });
