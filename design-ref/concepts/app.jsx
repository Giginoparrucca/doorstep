// Compose the canvas: 3 radically-different app concepts.

const CONCEPTS = [
  // ────────────────────────────────────────────────────────────────────
  // 01 · LETTERA — the app as a letter
  // ────────────────────────────────────────────────────────────────────
  {
    id: '01',
    name: 'Lettera',
    tagline: 'The app is a letter from your host. Prose-first. No card grid.',
    manifesto:
      "Today the welcome screen is a dashboard of tiles. Lettera throws that out: every screen is a single column of typeset prose, with key info embedded inline — wifi, door codes, opening hours appear inside the sentences that explain them. Navigation is five Roman-numeral chapters at the foot of the page. It reads like a thoughtful note left on the kitchen table.",
    bullets: [
      { label: 'Best for', text: 'Hosts whose voice is the product — small boutique B&Bs, agriturismi, family-run places.' },
      { label: 'New paradigm', text: 'Long-form scrolling letter; data shown inline as styled fragments rather than in cards.' },
      { label: 'Trade-off', text: 'Slower to scan than the current grid — guests in a hurry will miss things unless we add a "TL;DR" pinned to the top.' },
    ],
    palette: {
      bg: '#EDE3CC',
      ink: '#2A1810',
      soft: '#6B4A30',
      accent: '#8B2D1F',
      swatches: [
        { name:'Paper',  hex:'#EDE3CC', border:'rgba(42,24,16,0.18)' },
        { name:'Cream',  hex:'#F4ECD8', border:'rgba(42,24,16,0.18)' },
        { name:'Ink',    hex:'#2A1810' },
        { name:'Sepia',  hex:'#6B4A30' },
        { name:'Sigillo',hex:'#8B2D1F' },
      ],
    },
    font: {
      display:"'Newsreader', serif",
      displayWeight: 400,
      displayItalic: true,
      displayTracking:'-0.015em',
      body:"'Newsreader', serif",
      pair: 'Newsreader · Caveat',
    },
    Mock: LetteraMock,
  },

  // ────────────────────────────────────────────────────────────────────
  // 02 · ATLANTE — the app as a map
  // ────────────────────────────────────────────────────────────────────
  {
    id: '02',
    name: 'Atlante',
    tagline: 'The app is a map. Property is a pin; everything else lives in a sheet.',
    manifesto:
      "Atlante opens straight onto the neighbourhood. The property is the big red pin; recommendations are the small numbered ones. All structured info (wifi, codes, check-in times) is folded into a bottom-sheet drawer the guest pulls up. Navigation isn't a bottom bar — it's three floating action buttons (chat, wifi, lights/keyboxes) plus the map itself.",
    bullets: [
      { label: 'Best for', text: 'Properties where the location IS the value proposition — historic centres, beach towns, hard-to-find apartments.' },
      { label: 'New paradigm', text: 'Spatial-first home. The guest sees where they are before they see what they have.' },
      { label: 'Trade-off', text: 'Map tiles cost money at scale and need careful styling. We\'d either license Mapbox/Maptiler or commission a custom illustrated map per city.' },
    ],
    palette: {
      bg: '#EAE4D7',
      ink: '#1A1A1A',
      soft: '#6B6B6B',
      accent: '#E11D48',
      swatches: [
        { name:'Land',  hex:'#EAE4D7', border:'rgba(26,26,26,0.15)' },
        { name:'Park',  hex:'#C8D4AA' },
        { name:'Water', hex:'#B7CFDB' },
        { name:'Ink',   hex:'#1A1A1A' },
        { name:'Pin',   hex:'#E11D48' },
      ],
    },
    font: {
      display:"'Bricolage Grotesque', sans-serif",
      displayWeight: 600,
      displayItalic: false,
      displayTracking:'-0.025em',
      body:"'Geist', sans-serif",
      pair: 'Bricolage · Geist · JetBrains Mono',
    },
    Mock: AtlanteMock,
  },

  // ────────────────────────────────────────────────────────────────────
  // 03 · CARNET — the app as a boarding pass
  // ────────────────────────────────────────────────────────────────────
  {
    id: '03',
    name: 'Carnet',
    tagline: 'The app is a travel document. Document-grade, monospace, perforated.',
    manifesto:
      "Carnet borrows the visual grammar of boarding passes and old hotel registers: tabbed sections, dashed dividers, monospace field labels, a numeric booking code, a confirmation stamp, a QR stub at the bottom. The whole stay fits on one printable page. Navigation is a tab strip along the top of the ticket — same chrome as the document itself.",
    bullets: [
      { label: 'Best for', text: 'Hosts with multiple properties / business travellers — anyone who wants the app to feel official and information-dense.' },
      { label: 'New paradigm', text: 'One-screen "stay summary" instead of a multi-tab dashboard. Almost zero navigation needed for return visits.' },
      { label: 'Trade-off', text: 'Aesthetic risk: read by some as cold or transactional. Less room for warmth from the host — we\'d lean on a single quoted "note" field rather than prose.' },
    ],
    palette: {
      bg: '#F2EBE0',
      ink: '#0A1F3D',
      soft: '#5B6A82',
      accent: '#B22234',
      swatches: [
        { name:'Cream', hex:'#F2EBE0', border:'rgba(10,31,61,0.18)' },
        { name:'White', hex:'#FFFFFF', border:'rgba(10,31,61,0.18)' },
        { name:'Navy',  hex:'#0A1F3D' },
        { name:'Steel', hex:'#5B6A82' },
        { name:'Stamp', hex:'#B22234' },
      ],
    },
    font: {
      display:"'Tenor Sans', sans-serif",
      displayWeight: 400,
      displayItalic: false,
      displayTracking:'0.005em',
      body:"'Geist', sans-serif",
      pair: 'Tenor Sans · Geist · JetBrains Mono',
    },
    Mock: CarnetMock,
  },
];

function App() {
  return (
    <DesignCanvas>
      <DCSection
        id="brief"
        title="Three completely different WelcomeBnB apps"
        subtitle="Not just new colours — three different mental models for what a guest welcome app is. Each section pairs a manifesto with the new welcome screen, drawn for the same booking so you can compare like for like (Casa di Beatrice, Trastevere, guest Sara arriving today at 15:30)."
      >
        <DCArtboard id="brief-note" label="Read me" width={520} height={300}>
          <div style={{
            padding:'28px 30px', height:'100%', boxSizing:'border-box',
            background:'#FFF', color:'#1a1a1a',
            fontFamily:"'Geist', system-ui, sans-serif",
            display:'flex', flexDirection:'column', gap: 12,
          }}>
            <div style={{
              fontFamily:"'JetBrains Mono', monospace",
              fontSize: 10.5, letterSpacing:'0.22em',
              textTransform:'uppercase', color:'#6B6B6B', fontWeight: 500,
            }}>Round 2 — different apps, not different skins</div>
            <div style={{
              fontFamily:"'Newsreader', serif", fontStyle:'italic',
              fontSize: 26, lineHeight: 1.15, color:'#111',
            }}>
              The first four were the same app in different clothes. These three are different apps.
            </div>
            <div style={{fontSize: 13, lineHeight: 1.6, color:'#3a3a3a'}}>
              Each concept changes the <em>layout</em>, the <em>navigation</em>, and the <em>information density</em> — not only the palette. Read the manifesto, look at the screen, and tell me which one feels most like WelcomeBnB.
            </div>
            <div style={{marginTop:'auto', display:'flex', gap: 16, fontFamily:"'JetBrains Mono', monospace", fontSize: 10, letterSpacing:'0.18em', textTransform:'uppercase', color:'#6B6B6B', fontWeight: 600}}>
              <span style={{color:'#8B2D1F'}}>01 Lettera</span>
              <span style={{color:'#E11D48'}}>02 Atlante</span>
              <span style={{color:'#B22234'}}>03 Carnet</span>
            </div>
          </div>
        </DCArtboard>
      </DCSection>

      {CONCEPTS.map(concept => {
        const Mock = concept.Mock;
        return (
          <DCSection
            key={concept.id}
            id={`concept-${concept.id}`}
            title={`${concept.id} · ${concept.name}`}
            subtitle={concept.tagline}
          >
            <DCArtboard
              id={`${concept.id}-manifesto`}
              label="Manifesto"
              width={760}
              height={720}
            >
              <ConceptCard concept={concept} />
            </DCArtboard>

            <DCArtboard
              id={`${concept.id}-welcome`}
              label="Welcome screen"
              width={360}
              height={720}
            >
              <Mock />
            </DCArtboard>
          </DCSection>
        );
      })}
    </DesignCanvas>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
