// Compose the canvas: 4 directions × (palette, type specimen, welcome-screen mock).

const THEMES = [
  // ────────────────────────────────────────────────────────────────────
  // 1 · NOTTE — editorial night
  // ────────────────────────────────────────────────────────────────────
  {
    id: '01',
    name: 'Notte',
    tagline: 'Candle-lit · editorial dark · for guests arriving after dusk',
    manifesto:
      "The app opens like the door of a wine bar at 9pm. Warm amber on deep ink, soft cream type, generous whitespace. Photography becomes the room — UI recedes. Best for properties that lean restaurant-luxury and stay-in evenings: trulli, masserie, palazzi.",
    font: {
      display: "'Instrument Serif', 'Times New Roman', serif",
      displayName: 'Instrument Serif',
      displayWeight: 400,
      displayTracking: '-0.02em',
      displayItalic: false,
      displaySpecimen: 'Benvenuti a casa',
      body: "'Geist', -apple-system, system-ui, sans-serif",
      bodyName: 'Geist',
    },
    palette: {
      bg: '#100F0C',
      surface: '#1B1815',
      ink: '#ECE6D8',
      soft: '#8C8579',
      line: 'rgba(236,230,216,0.10)',
      softLine: '#ECE6D8',
      accent: '#E8B071',
      accentStrong: '#E8B071',
      accentInk: '#1B1815',
      iconStroke: '#ECE6D8',
      danger: '#E48A8A',
      dangerBg: 'rgba(228,138,138,0.08)',
      dangerLine: 'rgba(228,138,138,0.22)',
      swatches: [
        { name: 'Nero',    hex: '#100F0C', border: 'rgba(236,230,216,0.18)' },
        { name: 'Carbone', hex: '#1B1815', border: 'rgba(236,230,216,0.18)' },
        { name: 'Cream',   hex: '#ECE6D8' },
        { name: 'Sabbia',  hex: '#8C8579' },
        { name: 'Candela', hex: '#E8B071' },
      ],
    },
    hero: {
      heroBg: 'linear-gradient(160deg, #221C16 0%, #100F0C 70%)',
      heroOverlay: 'radial-gradient(120% 80% at 80% 100%, rgba(232,176,113,0.18) 0%, transparent 60%)',
      stripe: 'rgba(236,230,216,0.06)',
      heroText: '#ECE6D8',
      heroAccent: '#E8B071',
      heroSub: 'rgba(236,230,216,0.65)',
      badgeBg: 'rgba(236,230,216,0.06)',
      badgeBorder: 'rgba(236,230,216,0.18)',
      property: 'Palazzo Beatrice',
    },
  },

  // ────────────────────────────────────────────────────────────────────
  // 2 · MARINA — coastal modern
  // ────────────────────────────────────────────────────────────────────
  {
    id: '02',
    name: 'Marina',
    tagline: 'Chalky cool · soft serif · Cereal-magazine calm',
    manifesto:
      "Off-white paper, deep navy ink, a single warm coral spark for delight moments. Newsreader is a soft, low-contrast serif — feels like a thoughtful travel guide. Best for coastal stays, modern apartments, anything where 'serene' is the brief.",
    font: {
      display: "'Newsreader', 'Times New Roman', serif",
      displayName: 'Newsreader',
      displayWeight: 400,
      displayTracking: '-0.015em',
      displayItalic: false,
      displaySpecimen: 'Slow morning by the sea',
      body: "'Geist', -apple-system, system-ui, sans-serif",
      bodyName: 'Geist',
    },
    palette: {
      bg: '#F2EFE9',
      surface: '#FFFFFF',
      ink: '#1A2230',
      soft: '#6E7585',
      line: 'rgba(26,34,48,0.10)',
      softLine: '#1A2230',
      accent: '#2A5B7A',
      accentStrong: '#2A5B7A',
      accentInk: '#FFFFFF',
      iconStroke: '#1A2230',
      danger: '#C45A4A',
      dangerBg: 'rgba(196,90,74,0.07)',
      dangerLine: 'rgba(196,90,74,0.18)',
      swatches: [
        { name: 'Chalk',  hex: '#F2EFE9', border: 'rgba(26,34,48,0.12)' },
        { name: 'Paper',  hex: '#FFFFFF', border: 'rgba(26,34,48,0.12)' },
        { name: 'Ink',    hex: '#1A2230' },
        { name: 'Marina', hex: '#2A5B7A' },
        { name: 'Coral',  hex: '#E76F51' },
      ],
    },
    hero: {
      heroBg: 'linear-gradient(160deg, #3A7AA0 0%, #2A5B7A 100%)',
      heroOverlay: 'linear-gradient(180deg, transparent 30%, rgba(20,40,60,0.55) 100%)',
      stripe: 'rgba(255,255,255,0.18)',
      heroText: '#F5F2EC',
      heroAccent: '#E76F51',
      heroSub: 'rgba(245,242,236,0.75)',
      badgeBg: 'rgba(255,255,255,0.12)',
      badgeBorder: 'rgba(255,255,255,0.28)',
      property: 'Casa del Mare',
    },
  },

  // ────────────────────────────────────────────────────────────────────
  // 3 · LIMONE — sun-bleached citrus
  // ────────────────────────────────────────────────────────────────────
  {
    id: '03',
    name: 'Limone',
    tagline: 'Bone · citrus · leaf — sun-bleached and slightly editorial',
    manifesto:
      "A bone-paper background, olive ink, and two accents that talk to each other: dusty citrus and a deeper leaf green. Bricolage Grotesque has a friendly modern face — confident but not corporate. Best for properties with gardens, courtyards, anything Mediterranean.",
    font: {
      display: "'Bricolage Grotesque', system-ui, sans-serif",
      displayName: 'Bricolage Grotesque',
      displayWeight: 500,
      displayTracking: '-0.025em',
      displayItalic: false,
      displaySpecimen: 'Un caffè in giardino',
      body: "'Public Sans', -apple-system, system-ui, sans-serif",
      bodyName: 'Public Sans',
    },
    palette: {
      bg: '#F2EFE5',
      surface: '#FAF8F0',
      ink: '#2A2A20',
      soft: '#76755F',
      line: 'rgba(42,42,32,0.10)',
      softLine: '#2A2A20',
      accent: '#C7B23A',
      accentStrong: '#5A6B4A',
      accentInk: '#2A2A20',
      iconStroke: '#2A2A20',
      danger: '#B8543A',
      dangerBg: 'rgba(184,84,58,0.07)',
      dangerLine: 'rgba(184,84,58,0.20)',
      swatches: [
        { name: 'Bone',   hex: '#F2EFE5', border: 'rgba(42,42,32,0.12)' },
        { name: 'Cream',  hex: '#FAF8F0', border: 'rgba(42,42,32,0.12)' },
        { name: 'Olive',  hex: '#2A2A20' },
        { name: 'Limone', hex: '#C7B23A' },
        { name: 'Foglia', hex: '#5A6B4A' },
      ],
    },
    hero: {
      heroBg: 'linear-gradient(160deg, #D9C658 0%, #C7B23A 60%, #A89530 100%)',
      heroOverlay: 'linear-gradient(180deg, transparent 30%, rgba(42,42,32,0.45) 100%)',
      stripe: 'rgba(42,42,32,0.10)',
      heroText: '#2A2A20',
      heroAccent: '#5A6B4A',
      heroSub: 'rgba(42,42,32,0.65)',
      badgeBg: 'rgba(42,42,32,0.08)',
      badgeBorder: 'rgba(42,42,32,0.20)',
      property: 'Villa Limonaia',
    },
  },

  // ────────────────────────────────────────────────────────────────────
  // 4 · PONTE — gallery quiet
  // ────────────────────────────────────────────────────────────────────
  {
    id: '04',
    name: 'Ponte',
    tagline: 'Gallery white · single rust accent · strict typographic',
    manifesto:
      "The most minimal of the four. White paper, almost-black ink, one disciplined rust accent. Tenor Sans is a thin geometric display with classical proportions — quiet authority. Best for hosts who want the photography and the place to do the talking, with the app barely there.",
    font: {
      display: "'Tenor Sans', 'Helvetica Neue', sans-serif",
      displayName: 'Tenor Sans',
      displayWeight: 400,
      displayTracking: '0.005em',
      displayItalic: false,
      displaySpecimen: 'Una stanza tranquilla',
      body: "'Geist', -apple-system, system-ui, sans-serif",
      bodyName: 'Geist',
    },
    palette: {
      bg: '#F8F6F2',
      surface: '#FFFFFF',
      ink: '#111111',
      soft: '#6B6B6B',
      line: 'rgba(0,0,0,0.10)',
      softLine: '#111111',
      accent: '#B85C38',
      accentStrong: '#B85C38',
      accentInk: '#FFFFFF',
      iconStroke: '#111111',
      danger: '#B85C38',
      dangerBg: 'rgba(184,92,56,0.06)',
      dangerLine: 'rgba(184,92,56,0.18)',
      swatches: [
        { name: 'Paper',  hex: '#F8F6F2', border: 'rgba(0,0,0,0.12)' },
        { name: 'White',  hex: '#FFFFFF', border: 'rgba(0,0,0,0.12)' },
        { name: 'Ink',    hex: '#111111' },
        { name: 'Stone',  hex: '#6B6B6B' },
        { name: 'Rust',   hex: '#B85C38' },
      ],
    },
    hero: {
      heroBg: '#EFEBE3',
      heroOverlay: 'linear-gradient(180deg, transparent 40%, rgba(17,17,17,0.10) 100%)',
      stripe: 'rgba(17,17,17,0.06)',
      heroText: '#111111',
      heroAccent: '#B85C38',
      heroSub: 'rgba(17,17,17,0.55)',
      badgeBg: 'rgba(255,255,255,0.6)',
      badgeBorder: 'rgba(17,17,17,0.14)',
      property: 'Ponte House',
    },
  },
];

function App() {
  return (
    <DesignCanvas>
      <DCSection
        id="brief"
        title="WelcomeBnB — four redesign directions"
        subtitle="Each direction = a new palette + a new font pairing + the welcome screen reskinned. Pick one (or mix two) and I'll push it through every screen in the app."
      >
        <DCArtboard id="brief-note" label="Read me" width={520} height={300}>
          <div style={{
            padding: '28px 30px', height:'100%', boxSizing:'border-box',
            background:'#FFF', color:'#1a1a1a',
            fontFamily:"'Geist', system-ui, sans-serif",
            display:'flex', flexDirection:'column', gap: 14,
          }}>
            <div style={{
              fontFamily:'JetBrains Mono, monospace',
              fontSize: 10.5, letterSpacing:'0.22em',
              textTransform:'uppercase', color:'#6B6B6B', fontWeight: 500,
            }}>How to read this canvas</div>
            <div style={{
              fontFamily:"'Instrument Serif', serif",
              fontSize: 28, lineHeight: 1.1, color:'#111',
            }}>
              Four directions, three artboards each — <em>palette</em>, <em>type</em>, <em>welcome screen reskinned</em>.
            </div>
            <div style={{fontSize: 13.5, lineHeight: 1.55, color:'#3a3a3a', fontWeight: 300}}>
              The welcome screen content is identical across all four — only the design system changes — so you can compare apples to apples. Drag any artboard to reorder; click the maximise icon to focus.
            </div>
            <div style={{
              marginTop: 'auto',
              fontFamily:'JetBrains Mono, monospace',
              fontSize: 10.5, letterSpacing:'0.18em',
              textTransform:'uppercase', color:'#B85C38', fontWeight: 600,
            }}>↓ scroll for directions 01 – 04</div>
          </div>
        </DCArtboard>
      </DCSection>

      {THEMES.map(theme => (
        <DCSection
          key={theme.id}
          id={`dir-${theme.id}`}
          title={`${theme.id} · ${theme.name}`}
          subtitle={theme.tagline}
        >
          <DCArtboard
            id={`${theme.id}-palette`}
            label="Palette &amp; manifesto"
            width={780}
            height={620}
          >
            <PaletteCard theme={theme} />
          </DCArtboard>

          <DCArtboard
            id={`${theme.id}-type`}
            label="Type specimen"
            width={520}
            height={620}
          >
            <TypeCard theme={theme} />
          </DCArtboard>

          <DCArtboard
            id={`${theme.id}-welcome`}
            label="Welcome screen — reskinned"
            width={360}
            height={720}
          >
            <WelcomeMock theme={theme} />
          </DCArtboard>
        </DCSection>
      ))}
    </DesignCanvas>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
