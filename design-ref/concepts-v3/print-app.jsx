// Print layout for v3 — same scaffolding as round 2, three new concepts.

function PrintPage({ children }) {
  return <div className="print-page">{children}</div>;
}

function PrintAppV3() {
  return (
    <>
      {/* COVER */}
      <PrintPage>
        <div style={{
          width:'100%', height:'100%',
          background:'#FFFFFF', color:'#111',
          fontFamily:"'Geist', system-ui, sans-serif",
          padding:'56px 64px',
          display:'flex', flexDirection:'column',
          boxSizing:'border-box',
        }}>
          <div style={{display:'flex', alignItems:'baseline', gap: 16}}>
            <div style={{
              fontFamily:"'JetBrains Mono', monospace",
              fontSize: 11.5, letterSpacing:'0.22em',
              textTransform:'uppercase', color:'#6B6B6B', fontWeight: 600,
            }}>WelcomeBnB · Round 3</div>
            <div style={{flex:1, height:1, background:'#111', opacity:0.15}}/>
            <div style={{
              fontFamily:"'JetBrains Mono', monospace",
              fontSize: 11.5, letterSpacing:'0.22em',
              textTransform:'uppercase', color:'#6B6B6B', fontWeight: 600,
            }}>26 May 2026</div>
          </div>

          <div style={{
            fontFamily:"'Newsreader', serif", fontSize: 86, lineHeight: 1,
            fontWeight: 400, fontStyle:'italic', letterSpacing:'-0.02em',
            marginTop: 56, marginBottom: 6, color:'#111',
          }}>Three more paradigms</div>
          <div style={{
            fontFamily:"'Newsreader', serif", fontSize: 86, lineHeight: 1,
            fontWeight: 400, letterSpacing:'-0.02em',
            marginBottom: 28, color:'#111',
          }}>— now six in total.</div>

          <div style={{
            fontSize: 17, lineHeight: 1.6, color:'#3a3a3a',
            maxWidth: 720, fontWeight: 400,
          }}>
            These three push further from a traditional app: a chat thread,
            a scrapbook page, a timeline of the stay. Same booking content
            (Sara → Casa di Beatrice, today at 15:30) — three more frames
            around it.
          </div>

          <div style={{flex:1}}/>

          <div style={{display:'flex', gap: 28, alignItems:'flex-end'}}>
            {[
              { n:'04', name:'Stanza', desc:'The app is a chat thread with the host', color:'#4A6B4A' },
              { n:'05', name:'Diario', desc:'The app is a scrapbook page',           color:'#1E2660' },
              { n:'06', name:'Adagio', desc:'The app is a timeline of your stay',    color:'#F26B3A' },
            ].map(c => (
              <div key={c.n} style={{flex:1}}>
                <div style={{
                  fontFamily:"'JetBrains Mono', monospace",
                  fontSize: 11, letterSpacing:'0.2em',
                  fontWeight: 700, color: c.color, marginBottom: 6,
                }}>{c.n}</div>
                <div style={{
                  fontFamily:"'Newsreader', serif",
                  fontSize: 28, lineHeight: 1, fontWeight: 500,
                  letterSpacing:'-0.015em', marginBottom: 6,
                }}>{c.name}</div>
                <div style={{fontSize: 13, color:'#6B6B6B', lineHeight: 1.45}}>{c.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </PrintPage>

      {[
        {
          id:'04', name:'Stanza',
          tagline:'The app is a chat thread with your host. No dashboard at all.',
          manifesto:"Stanza deletes the home screen. There is one screen: the conversation with Beatrice. Wifi, door codes, check-in times — all arrive as messages from the host, with the most important ones pinned to a strip at the top. The AI concierge sits inside the same thread (a small toggle), so guests never have to leave to ask a question. Reduces the app to one habit: open chat, scroll up.",
          bullets:[
            { label:'Best for', text:'Hosts who already chat a lot with guests on WhatsApp. The app becomes the place where those conversations live (and where the bot helps when the host is asleep).' },
            { label:'New paradigm', text:'One surface, infinite content. No navigation between sections — everything is reachable via /commands or pinned messages.' },
            { label:'Trade-off', text:'Asks the host to write more. We\u2019d need pre-written templates per property that the system can post automatically when a booking is confirmed.' },
          ],
          palette:{ bg:'#F2EFE9', ink:'#1A1A14', soft:'#6E6E5F', accent:'#4A6B4A',
            swatches:[
              { name:'Paper',   hex:'#F2EFE9', border:'rgba(26,26,20,0.18)' },
              { name:'White',   hex:'#FFFFFF', border:'rgba(26,26,20,0.18)' },
              { name:'Ink',     hex:'#1A1A14' },
              { name:'Sand',    hex:'#D9C4A0' },
              { name:'Olive',   hex:'#4A6B4A' },
            ]},
          font:{ display:"'Bricolage Grotesque', sans-serif", displayWeight:600, displayItalic:false, displayTracking:'-0.02em', body:"'Geist', sans-serif", pair:'Bricolage · Geist · JetBrains Mono' },
          Mock: StanzaMock,
        },
        {
          id:'05', name:'Diario',
          tagline:'The app is a scrapbook page. Polaroids, Post-its, luggage tags, handwriting.',
          manifesto:"Diario treats every screen as a journal page from the host. The wifi password is on a yellow Post-it. The door code is on a luggage tag tied with string. Polaroids of the apartment hang from washi tape. The host's note is in handwriting, in fountain-pen blue. Chapters are paper bookmarks along the bottom. Maximum warmth, maximum tactility — the opposite of an app.",
          bullets:[
            { label:'Best for', text:'Slow-tourism hosts: agriturismi, masserie, rural B&Bs. Anyone whose competitive edge is feeling.' },
            { label:'New paradigm', text:'Affordances borrow from physical objects (post-its, tape, tags), not from web/app conventions. Reading speed slows on purpose.' },
            { label:'Trade-off', text:'Highest illustration cost — needs real photography (or a stylised illustration kit) for the polaroids to land. Risk: looks twee if rushed.' },
          ],
          palette:{ bg:'#F4EDD7', ink:'#2A2418', soft:'#6B6356', accent:'#1E2660',
            swatches:[
              { name:'Paper',   hex:'#F4EDD7', border:'rgba(30,38,96,0.18)' },
              { name:'Post-it', hex:'#F7DC6F' },
              { name:'Tag',     hex:'#E8D9B8' },
              { name:'Penna',   hex:'#1E2660' },
              { name:'Rosso',   hex:'#C9302C' },
            ]},
          font:{ display:"'Caveat', cursive", displayWeight:700, displayItalic:false, displayTracking:'-0.005em', body:"'Newsreader', serif", pair:'Caveat · Newsreader · JetBrains Mono' },
          Mock: DiarioMock,
        },
        {
          id:'06', name:'Adagio',
          tagline:'The app is a timeline of your stay. Time is the organising principle.',
          manifesto:"Adagio organises everything by when it matters. The home screen is a vertical timeline of your stay; the current moment glows orange in the middle. Past events fade. Future events stay quiet until they're close. A big \u201cNow\u201d card always shows exactly what the guest needs in this 5-minute window — the door code at 15:00, the dinner reservation at 20:00, the quiet hours at 23:00. Almost no information is shown if it isn't relevant yet.",
          bullets:[
            { label:'Best for', text:'Tour-style or experience-led stays — properties bundled with breakfast slots, transfers, tastings, classes. Anything where the day has a rhythm.' },
            { label:'New paradigm', text:'Time-aware content. The same screen shows different things at 14:00 vs 23:00 vs check-out morning. Push notifications become first-class.' },
            { label:'Trade-off', text:'Most engineering work of the six concepts. Needs reliable event scheduling, timezone handling, and per-host templates. Big payoff but real lift.' },
          ],
          palette:{ bg:'#FBFAF6', ink:'#0F0F11', soft:'#76767F', accent:'#F26B3A',
            swatches:[
              { name:'Off-white', hex:'#FBFAF6', border:'rgba(15,15,17,0.12)' },
              { name:'White',     hex:'#FFFFFF', border:'rgba(15,15,17,0.12)' },
              { name:'Ink',       hex:'#0F0F11' },
              { name:'Stone',     hex:'#76767F' },
              { name:'Ora',       hex:'#F26B3A' },
            ]},
          font:{ display:"'Bricolage Grotesque', sans-serif", displayWeight:600, displayItalic:false, displayTracking:'-0.025em', body:"'Geist', sans-serif", pair:'Bricolage · Geist · JetBrains Mono' },
          Mock: AdagioMock,
        },
      ].map(concept => {
        const Mock = concept.Mock;
        return (
          <PrintPage key={concept.id}>
            <div style={{
              display:'flex', gap: 32, height:'100%', padding: 28,
              boxSizing:'border-box', background:'#FFF',
            }}>
              <div style={{
                flex:1, border:'1px solid rgba(0,0,0,0.10)',
                background: concept.palette.bg,
                borderRadius: 6, overflow:'hidden',
                display:'flex', flexDirection:'column',
              }}>
                <ConceptCard concept={concept}/>
              </div>
              <div style={{
                width: 360, flexShrink: 0,
                display:'flex', flexDirection:'column', alignItems:'center',
              }}>
                <div style={{
                  fontFamily:"'JetBrains Mono', monospace",
                  fontSize: 10, letterSpacing:'0.22em', textTransform:'uppercase',
                  color:'#6B6B6B', fontWeight: 600, marginBottom: 10,
                }}>Welcome screen</div>
                <div style={{
                  width: 360, height: 720,
                  borderRadius: 28, overflow:'hidden',
                  boxShadow:'0 2px 0 rgba(0,0,0,0.04), 0 18px 40px rgba(0,0,0,0.10)',
                  border:'1px solid rgba(0,0,0,0.08)',
                }}>
                  <Mock/>
                </div>
              </div>
            </div>
          </PrintPage>
        );
      })}
    </>
  );
}

async function bootPrintV3() {
  try { await document.fonts.ready; } catch (_) {}
  await new Promise(r => setTimeout(r, 600));
  window.print();
}

ReactDOM.createRoot(document.getElementById('root')).render(<PrintAppV3/>);
window.addEventListener('load', () => { setTimeout(bootPrintV3, 100); });
