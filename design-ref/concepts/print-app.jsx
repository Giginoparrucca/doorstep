// Print layout — one concept per landscape page. Reuses the same mocks.

function PrintPage({ children, ...rest }) {
  return (
    <div className="print-page" {...rest}>
      {children}
    </div>
  );
}

function PrintApp() {
  return (
    <>
      {/* COVER */}
      <PrintPage>
        <div style={{
          width:'100%', height:'100%',
          background:'#FFFFFF',
          color:'#111',
          fontFamily:"'Geist', system-ui, sans-serif",
          padding:'56px 64px',
          display:'flex', flexDirection:'column',
          boxSizing:'border-box',
        }}>
          <div style={{
            display:'flex', alignItems:'baseline', gap: 16,
          }}>
            <div style={{
              fontFamily:"'JetBrains Mono', monospace",
              fontSize: 11.5, letterSpacing:'0.22em',
              textTransform:'uppercase', color:'#6B6B6B', fontWeight: 600,
            }}>WelcomeBnB · Round 2</div>
            <div style={{flex:1, height:1, background:'#111', opacity:0.15}}/>
            <div style={{
              fontFamily:"'JetBrains Mono', monospace",
              fontSize: 11.5, letterSpacing:'0.22em',
              textTransform:'uppercase', color:'#6B6B6B', fontWeight: 600,
            }}>26 May 2026</div>
          </div>

          <div style={{
            fontFamily:"'Newsreader', serif",
            fontSize: 90, lineHeight: 1, fontWeight: 400, fontStyle:'italic',
            letterSpacing:'-0.02em', color:'#111',
            marginTop: 60, marginBottom: 8,
          }}>Three different apps,</div>
          <div style={{
            fontFamily:"'Newsreader', serif",
            fontSize: 90, lineHeight: 1, fontWeight: 400,
            letterSpacing:'-0.02em', color:'#111',
            marginBottom: 28,
          }}>not three palettes.</div>

          <div style={{
            fontSize: 17, lineHeight: 1.6, color:'#3a3a3a', maxWidth: 720,
            fontWeight: 400,
          }}>
            The first round was the same app in different clothes. This round
            changes the mental model entirely — the layout, the navigation,
            and the information density. Same booking (Sara → Casa di
            Beatrice, Trastevere, today at 15:30) rendered three ways so the
            comparison is metaphor versus metaphor.
          </div>

          <div style={{flex:1}}/>

          <div style={{
            display:'flex', gap: 28, alignItems:'flex-end',
          }}>
            {[
              { n:'01', name:'Lettera', desc:'The app is a letter from the host', color:'#8B2D1F' },
              { n:'02', name:'Atlante', desc:'The app is a stylised map',         color:'#E11D48' },
              { n:'03', name:'Carnet',  desc:'The app is a boarding pass',         color:'#B22234' },
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

      {/* Each concept */}
      {[
        {
          id:'01', name:'Lettera',
          tagline:'The app is a letter from your host. Prose-first. No card grid.',
          manifesto:"Today the welcome screen is a dashboard of tiles. Lettera throws that out: every screen is a single column of typeset prose, with key info embedded inline — wifi, door codes, opening hours appear inside the sentences that explain them. Navigation is five Roman-numeral chapters at the foot of the page. It reads like a thoughtful note left on the kitchen table.",
          bullets: [
            { label:'Best for', text:'Hosts whose voice is the product — small boutique B&Bs, agriturismi, family-run places.' },
            { label:'New paradigm', text:'Long-form scrolling letter; data shown inline as styled fragments rather than in cards.' },
            { label:'Trade-off', text:'Slower to scan than the current grid — guests in a hurry will miss things unless we add a "TL;DR" pinned to the top.' },
          ],
          palette:{ bg:'#EDE3CC', ink:'#2A1810', soft:'#6B4A30', accent:'#8B2D1F',
            swatches:[
              { name:'Paper',  hex:'#EDE3CC', border:'rgba(42,24,16,0.18)' },
              { name:'Cream',  hex:'#F4ECD8', border:'rgba(42,24,16,0.18)' },
              { name:'Ink',    hex:'#2A1810' },
              { name:'Sepia',  hex:'#6B4A30' },
              { name:'Sigillo',hex:'#8B2D1F' },
            ]},
          font:{ display:"'Newsreader', serif", displayWeight:400, displayItalic:true, displayTracking:'-0.015em', body:"'Newsreader', serif", pair:'Newsreader · Caveat' },
          Mock: LetteraMock,
        },
        {
          id:'02', name:'Atlante',
          tagline:'The app is a map. Property is a pin; everything else lives in a sheet.',
          manifesto:"Atlante opens straight onto the neighbourhood. The property is the big red pin; recommendations are the small numbered ones. All structured info (wifi, codes, check-in times) is folded into a bottom-sheet drawer the guest pulls up. Navigation isn't a bottom bar — it's three floating action buttons (chat, wifi, lights/keyboxes) plus the map itself.",
          bullets: [
            { label:'Best for', text:'Properties where the location IS the value proposition — historic centres, beach towns, hard-to-find apartments.' },
            { label:'New paradigm', text:'Spatial-first home. The guest sees where they are before they see what they have.' },
            { label:'Trade-off', text:'Map tiles cost money at scale and need careful styling. We\u2019d either license Mapbox/Maptiler or commission a custom illustrated map per city.' },
          ],
          palette:{ bg:'#EAE4D7', ink:'#1A1A1A', soft:'#6B6B6B', accent:'#E11D48',
            swatches:[
              { name:'Land',  hex:'#EAE4D7', border:'rgba(26,26,26,0.15)' },
              { name:'Park',  hex:'#C8D4AA' },
              { name:'Water', hex:'#B7CFDB' },
              { name:'Ink',   hex:'#1A1A1A' },
              { name:'Pin',   hex:'#E11D48' },
            ]},
          font:{ display:"'Bricolage Grotesque', sans-serif", displayWeight:600, displayItalic:false, displayTracking:'-0.025em', body:"'Geist', sans-serif", pair:'Bricolage · Geist · JetBrains Mono' },
          Mock: AtlanteMock,
        },
        {
          id:'03', name:'Carnet',
          tagline:'The app is a travel document. Document-grade, monospace, perforated.',
          manifesto:"Carnet borrows the visual grammar of boarding passes and old hotel registers: tabbed sections, dashed dividers, monospace field labels, a numeric booking code, a confirmation stamp, a QR stub at the bottom. The whole stay fits on one printable page. Navigation is a tab strip along the top of the ticket — same chrome as the document itself.",
          bullets: [
            { label:'Best for', text:'Hosts with multiple properties / business travellers — anyone who wants the app to feel official and information-dense.' },
            { label:'New paradigm', text:'One-screen "stay summary" instead of a multi-tab dashboard. Almost zero navigation needed for return visits.' },
            { label:'Trade-off', text:'Aesthetic risk: read by some as cold or transactional. Less room for warmth from the host — we\u2019d lean on a single quoted "note" field rather than prose.' },
          ],
          palette:{ bg:'#F2EBE0', ink:'#0A1F3D', soft:'#5B6A82', accent:'#B22234',
            swatches:[
              { name:'Cream', hex:'#F2EBE0', border:'rgba(10,31,61,0.18)' },
              { name:'White', hex:'#FFFFFF', border:'rgba(10,31,61,0.18)' },
              { name:'Navy',  hex:'#0A1F3D' },
              { name:'Steel', hex:'#5B6A82' },
              { name:'Stamp', hex:'#B22234' },
            ]},
          font:{ display:"'Tenor Sans', sans-serif", displayWeight:400, displayItalic:false, displayTracking:'0.005em', body:"'Geist', sans-serif", pair:'Tenor Sans · Geist · JetBrains Mono' },
          Mock: CarnetMock,
        },
      ].map(concept => {
        const Mock = concept.Mock;
        return (
          <PrintPage key={concept.id}>
            <div style={{
              display:'flex', gap: 32, height:'100%', padding: 28,
              boxSizing:'border-box', background:'#FFF',
            }}>
              {/* Manifesto */}
              <div style={{
                flex:1, border:'1px solid rgba(0,0,0,0.10)',
                background: concept.palette.bg,
                borderRadius: 6, overflow:'hidden',
                display:'flex', flexDirection:'column',
              }}>
                <ConceptCard concept={concept}/>
              </div>

              {/* Phone */}
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

// Auto-print after fonts + layout settle.
async function bootPrint() {
  try { await document.fonts.ready; } catch (_) {}
  await new Promise(r => setTimeout(r, 600));
  window.print();
}

ReactDOM.createRoot(document.getElementById('root')).render(<PrintApp/>);
window.addEventListener('load', () => { setTimeout(bootPrint, 100); });
