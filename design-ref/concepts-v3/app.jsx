// Compose: 3 NEW concepts (chat, scrapbook, time-aware).

const CONCEPTS_V3 = [
  // ────────────────────────────────────────────────────────────────────
  // 04 · STANZA — the app as a chat thread
  // ────────────────────────────────────────────────────────────────────
  {
    id: '04',
    name: 'Stanza',
    tagline: 'The app is a chat thread with your host. No dashboard at all.',
    manifesto:
      "Stanza deletes the home screen. There is one screen: the conversation with Beatrice. Wifi, door codes, check-in times — all arrive as messages from the host, with the most important ones pinned to a strip at the top. The AI concierge sits inside the same thread (a small toggle), so guests never have to leave to ask a question. Reduces the app to one habit: open chat, scroll up.",
    bullets: [
      { label: 'Best for', text: 'Hosts who already chat a lot with guests on WhatsApp. The app becomes the place where those conversations live (and where the bot helps when the host is asleep).' },
      { label: 'New paradigm', text: 'One surface, infinite content. No navigation between sections — everything is reachable via /commands or pinned messages.' },
      { label: 'Trade-off', text: 'Asks the host to write more. We\u2019d need pre-written templates per property that the system can post automatically when a booking is confirmed.' },
    ],
    palette: {
      bg: '#F2EFE9',
      ink: '#1A1A14',
      soft: '#6E6E5F',
      accent: '#4A6B4A',
      swatches: [
        { name:'Paper',   hex:'#F2EFE9', border:'rgba(26,26,20,0.18)' },
        { name:'White',   hex:'#FFFFFF', border:'rgba(26,26,20,0.18)' },
        { name:'Ink',     hex:'#1A1A14' },
        { name:'Sand',    hex:'#D9C4A0' },
        { name:'Olive',   hex:'#4A6B4A' },
      ],
    },
    font: {
      display:"'Bricolage Grotesque', sans-serif",
      displayWeight: 600,
      displayItalic: false,
      displayTracking:'-0.02em',
      body:"'Geist', sans-serif",
      pair:'Bricolage · Geist · JetBrains Mono',
    },
    Mock: StanzaMock,
  },

  // ────────────────────────────────────────────────────────────────────
  // 05 · DIARIO — the app as a scrapbook
  // ────────────────────────────────────────────────────────────────────
  {
    id: '05',
    name: 'Diario',
    tagline: 'The app is a scrapbook page. Polaroids, Post-its, luggage tags, handwriting.',
    manifesto:
      "Diario treats every screen as a journal page from the host. The wifi password is on a yellow Post-it. The door code is on a luggage tag tied with string. Polaroids of the apartment hang from washi tape. The host's note is in handwriting, in fountain-pen blue. Chapters are paper bookmarks along the bottom. Maximum warmth, maximum tactility — the opposite of an app.",
    bullets: [
      { label: 'Best for', text: 'Slow-tourism hosts: agriturismi, masserie, rural B&Bs. Anyone whose competitive edge is feeling.' },
      { label: 'New paradigm', text: 'Affordances borrow from physical objects (post-its, tape, tags), not from web/app conventions. Reading speed slows on purpose.' },
      { label: 'Trade-off', text: 'Highest illustration cost — needs real photography (or a stylised illustration kit) for the polaroids to land. Risk: looks twee if rushed.' },
    ],
    palette: {
      bg: '#F4EDD7',
      ink: '#2A2418',
      soft: '#6B6356',
      accent: '#1E2660',
      swatches: [
        { name:'Paper',   hex:'#F4EDD7', border:'rgba(30,38,96,0.18)' },
        { name:'Post-it', hex:'#F7DC6F' },
        { name:'Tag',     hex:'#E8D9B8' },
        { name:'Penna',   hex:'#1E2660' },
        { name:'Rosso',   hex:'#C9302C' },
      ],
    },
    font: {
      display:"'Caveat', cursive",
      displayWeight: 700,
      displayItalic: false,
      displayTracking:'-0.005em',
      body:"'Newsreader', serif",
      pair:'Caveat · Newsreader · JetBrains Mono',
    },
    Mock: DiarioMock,
  },

  // ────────────────────────────────────────────────────────────────────
  // 06 · ADAGIO — the app as a timeline
  // ────────────────────────────────────────────────────────────────────
  {
    id: '06',
    name: 'Adagio',
    tagline: 'The app is a timeline of your stay. Time is the organising principle.',
    manifesto:
      "Adagio organises everything by when it matters. The home screen is a vertical timeline of your stay; the current moment glows orange in the middle. Past events fade. Future events stay quiet until they\u2019re close. A big \u201cNow\u201d card always shows exactly what the guest needs in this 5-minute window — the door code at 15:00, the dinner reservation at 20:00, the quiet hours at 23:00. Almost no information is shown if it isn't relevant yet.",
    bullets: [
      { label: 'Best for', text: 'Tour-style or experience-led stays — properties bundled with breakfast slots, transfers, tastings, classes. Anything where the day has a rhythm.' },
      { label: 'New paradigm', text: 'Time-aware content. The same screen shows different things at 14:00 vs 23:00 vs check-out morning. Push notifications become first-class.' },
      { label: 'Trade-off', text: 'Most engineering work of the six concepts. Needs reliable event scheduling, timezone handling, and per-host templates. Big payoff but real lift.' },
    ],
    palette: {
      bg: '#FBFAF6',
      ink: '#0F0F11',
      soft: '#76767F',
      accent: '#F26B3A',
      swatches: [
        { name:'Off-white', hex:'#FBFAF6', border:'rgba(15,15,17,0.12)' },
        { name:'White',     hex:'#FFFFFF', border:'rgba(15,15,17,0.12)' },
        { name:'Ink',       hex:'#0F0F11' },
        { name:'Stone',     hex:'#76767F' },
        { name:'Ora',       hex:'#F26B3A' },
      ],
    },
    font: {
      display:"'Bricolage Grotesque', sans-serif",
      displayWeight: 600,
      displayItalic: false,
      displayTracking:'-0.025em',
      body:"'Geist', sans-serif",
      pair:'Bricolage · Geist · JetBrains Mono',
    },
    Mock: AdagioMock,
  },
];

function App() {
  return (
    <DesignCanvas>
      <DCSection
        id="brief"
        title="Three more concepts — different paradigms again"
        subtitle="Now six total to choose from. These three move further from a traditional app: chat-thread-as-app (Stanza), scrapbook-as-app (Diario), timeline-as-app (Adagio). Same booking, same content, three more frames around it."
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
            }}>Round 3 — three more to choose from</div>
            <div style={{
              fontFamily:"'Newsreader', serif", fontStyle:'italic',
              fontSize: 26, lineHeight: 1.15, color:'#111',
            }}>
              Six total: Lettera, Atlante, Carnet — and now Stanza, Diario, Adagio.
            </div>
            <div style={{fontSize: 13, lineHeight: 1.6, color:'#3a3a3a'}}>
              Each section pairs a manifesto (left) with the welcome screen drawn in that paradigm (right). Tell me which one (or which two, if you want a hybrid) and I'll push it through every screen of the app.
            </div>
            <div style={{marginTop:'auto', display:'flex', gap: 14, flexWrap:'wrap', fontFamily:"'JetBrains Mono', monospace", fontSize: 10, letterSpacing:'0.18em', textTransform:'uppercase', fontWeight: 600}}>
              <span style={{color:'#4A6B4A'}}>04 Stanza</span>
              <span style={{color:'#1E2660'}}>05 Diario</span>
              <span style={{color:'#F26B3A'}}>06 Adagio</span>
            </div>
          </div>
        </DCArtboard>
      </DCSection>

      {CONCEPTS_V3.map(concept => {
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
