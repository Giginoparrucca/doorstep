// LETTERA — the app as a long-form letter from the host.
// No card grid. No bottom nav. The "screen" is a continuous letter on paper.
// Navigation is a chapter strip at the very bottom (Roman numerals).

function LetteraMock({ chapter = 'I' }) {
  return (
    <div style={{
      width:'100%', height:'100%',
      background:'#EDE3CC',
      // subtle paper grain
      backgroundImage:
        'radial-gradient(rgba(60,40,20,0.05) 1px, transparent 1px),' +
        'radial-gradient(rgba(60,40,20,0.04) 1px, transparent 1px)',
      backgroundSize: '8px 8px, 13px 13px',
      backgroundPosition: '0 0, 4px 6px',
      color:'#2A1810',
      fontFamily:"'Newsreader', 'Times New Roman', serif",
      display:'flex', flexDirection:'column',
      overflow:'hidden',
      boxSizing:'border-box',
      position:'relative',
    }}>
      {/* Top edge — postage strip */}
      <div style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding: '14px 22px 8px',
        fontFamily:"'JetBrains Mono', monospace",
        fontSize: 9, letterSpacing:'0.22em', textTransform:'uppercase',
        color:'#6B4A30',
      }}>
        <div style={{display:'flex', alignItems:'center', gap: 8}}>
          {/* stamp */}
          <div style={{
            width: 28, height: 28,
            border:'1px dashed #8B2D1F',
            display:'flex', alignItems:'center', justifyContent:'center',
            color:'#8B2D1F',
            fontFamily:"'Newsreader', serif", fontStyle:'italic',
            fontSize: 16, fontWeight: 500,
            transform:'rotate(-4deg)',
          }}>W</div>
          <span>Via Aerea · Roma</span>
        </div>
        <span>EN · it</span>
      </div>

      {/* Scroll region — the letter */}
      <div style={{
        flex:1, padding: '8px 26px 6px',
        overflow:'hidden',
      }}>
        {/* Letterhead */}
        <div style={{
          textAlign:'right',
          fontFamily:"'JetBrains Mono', monospace",
          fontSize: 9.5, letterSpacing:'0.18em', textTransform:'uppercase',
          color:'#6B4A30', marginBottom: 2, lineHeight: 1.5,
        }}>
          Casa di Beatrice<br/>
          Vicolo del Cinque 11, Trastevere
        </div>
        <div style={{
          textAlign:'right',
          fontFamily:"'Newsreader', serif", fontStyle:'italic',
          fontSize: 12, color:'#6B4A30', marginBottom: 18,
        }}>
          26 May 2026
        </div>

        {/* Salutation */}
        <div style={{
          fontFamily:"'Newsreader', serif", fontStyle:'italic',
          fontSize: 30, fontWeight: 400, lineHeight: 1.1,
          color:'#2A1810', marginBottom: 14,
          letterSpacing:'-0.015em',
        }}>Cara Sara,</div>

        {/* Body */}
        <div style={{
          fontFamily:"'Newsreader', serif",
          fontSize: 14.5, lineHeight: 1.65,
          color:'#2A1810', fontWeight: 400,
          textWrap: 'pretty',
        }}>
          <p style={{margin:'0 0 12px'}}>
            We've left the keys in the brass box by the door — the code is{' '}
            <span style={{
              fontFamily:"'JetBrains Mono', monospace",
              fontSize: 12.5, fontWeight: 700,
              padding:'2px 7px',
              background:'#8B2D1F', color:'#F4ECD8',
              borderRadius: 2, letterSpacing:'0.06em',
            }}>4419</span>
            . Push hard, the latch sticks in May.
          </p>
          <p style={{margin:'0 0 12px'}}>
            The Wi-Fi is{' '}
            <em style={{fontWeight:500, fontStyle:'italic', textDecoration:'underline', textDecorationStyle:'dotted', textUnderlineOffset:'3px'}}>Casa-Bea</em>
            , password{' '}
            <span style={{fontFamily:"'JetBrains Mono', monospace", fontSize:12.5, fontWeight:500}}>ciao2026</span>
            . There is fresh coffee in the small cupboard above the stove and a bottle of Greco di Tufo in the fridge —{' '}
            <em style={{fontStyle:'italic'}}>per voi</em>.
          </p>

          {/* Inset — like a pasted note */}
          <div style={{
            margin: '14px 0 14px 0',
            padding: '12px 14px',
            background:'rgba(139,45,31,0.06)',
            border:'1px solid rgba(139,45,31,0.22)',
            borderLeft:'3px solid #8B2D1F',
            position:'relative',
          }}>
            <div style={{
              fontFamily:"'JetBrains Mono', monospace",
              fontSize: 9, letterSpacing:'0.22em', textTransform:'uppercase',
              color:'#8B2D1F', fontWeight: 600, marginBottom: 4,
            }}>P.S. — for the law</div>
            <div style={{fontSize: 12.5, lineHeight: 1.55, color:'#2A1810'}}>
              Italy asks me to register everyone who sleeps here. Two minutes — take a photo of your passport, the form fills itself. <em>Tap here.</em>
            </div>
          </div>

          <p style={{margin:'0 0 12px'}}>
            The bakery on the corner opens at seven; ask for a{' '}
            <em style={{fontStyle:'italic'}}>maritozzo</em>{' '}and don't let them talk you into anything else. If you need us for anything at all, we are five minutes away.
          </p>
        </div>

        {/* Signature */}
        <div style={{
          marginTop: 14,
          fontFamily:"'Caveat', cursive",
          fontSize: 32, color:'#8B2D1F',
          lineHeight: 1,
        }}>Beatrice &amp; Marco</div>
      </div>

      {/* Chapter strip — Roman numerals */}
      <div style={{
        display:'flex', alignItems:'stretch',
        borderTop:'1px solid rgba(42,24,16,0.25)',
        background:'rgba(244,236,216,0.7)',
        flexShrink: 0,
      }}>
        {[
          { n:'I',   label:'Welcome' },
          { n:'II',  label:'Check-in' },
          { n:'III', label:'House' },
          { n:'IV',  label:'Around' },
          { n:'V',   label:'Reply' },
        ].map(c => (
          <div key={c.n} style={{
            flex:1, padding:'10px 4px',
            textAlign:'center',
            borderRight: c.n === 'V' ? 'none' : '1px solid rgba(42,24,16,0.12)',
            color: c.n === chapter ? '#8B2D1F' : '#6B4A30',
            background: c.n === chapter ? 'rgba(139,45,31,0.06)' : 'transparent',
          }}>
            <div style={{
              fontFamily:"'Newsreader', serif", fontStyle:'italic',
              fontSize: 16, fontWeight: 500, lineHeight: 1,
            }}>{c.n}</div>
            <div style={{
              fontFamily:"'JetBrains Mono', monospace",
              fontSize: 8, letterSpacing:'0.16em', textTransform:'uppercase',
              marginTop: 3, fontWeight: 500,
            }}>{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

window.LetteraMock = LetteraMock;
