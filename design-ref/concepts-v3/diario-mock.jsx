// DIARIO — the app as a scrapbook page from a guest journal.
// Polaroids, washi tape, Post-its, a luggage tag with the door code,
// handwritten captions. Tactile and warm.

function DiarioMock() {
  const C = {
    paper:'#F4EDD7',
    paperRule:'rgba(30,38,96,0.06)',
    ink:'#1E2660',          // fountain-pen blue
    inkSoft:'#4A549B',
    text:'#2A2418',
    soft:'#6B6356',
    postit:'#F7DC6F',
    postitInk:'#5C4B14',
    tag:'#E8D9B8',
    tape:'#E8E4D8',
    redPen:'#C9302C',
  };

  // Helper: ruled paper background
  const ruled = {
    background: C.paper,
    backgroundImage:
      `repeating-linear-gradient(180deg, transparent 0 22px, ${C.paperRule} 22px 23px)`,
    backgroundPositionY: 16,
  };

  return (
    <div style={{
      width:'100%', height:'100%',
      ...ruled,
      color: C.text,
      fontFamily:"'Newsreader', serif",
      display:'flex', flexDirection:'column',
      overflow:'hidden', position:'relative',
      boxSizing:'border-box',
    }}>
      {/* Margin red line — left edge */}
      <div style={{
        position:'absolute', left: 30, top: 0, bottom: 0,
        width: 1, background: C.redPen, opacity: 0.35,
      }}/>
      {/* binding holes */}
      {[110, 360, 610].map(y => (
        <div key={y} style={{
          position:'absolute', left: 10, top: y,
          width: 10, height: 10, borderRadius:'50%',
          background:'rgba(0,0,0,0.08)',
          boxShadow:'inset 0 1px 2px rgba(0,0,0,0.12)',
        }}/>
      ))}

      {/* Top — date & language */}
      <div style={{
        padding:'14px 18px 0 44px',
        display:'flex', alignItems:'baseline', justifyContent:'space-between',
      }}>
        <div style={{
          fontFamily:"'Caveat', cursive",
          fontSize: 22, color: C.ink, lineHeight: 1,
        }}>Roma — Day 1</div>
        <div style={{
          fontFamily:"'Caveat', cursive",
          fontSize: 16, color: C.inkSoft,
        }}>tuesday · 26 may</div>
      </div>

      {/* Headline — handwritten */}
      <div style={{
        padding:'2px 18px 4px 44px',
        fontFamily:"'Caveat', cursive",
        fontSize: 40, lineHeight: 1, color: C.ink,
        fontWeight: 700, letterSpacing:'-0.005em',
      }}>Casa di Beatrice</div>
      <div style={{
        padding:'0 18px 8px 44px',
        fontFamily:"'Newsreader', serif", fontStyle:'italic',
        fontSize: 13, color: C.soft,
      }}>Vicolo del Cinque 11, Trastevere</div>

      {/* Polaroid + post-it row */}
      <div style={{
        position:'relative', height: 198, margin:'8px 14px 4px 38px',
      }}>
        {/* Washi tape across top of polaroid */}
        <div style={{
          position:'absolute', top: 10, left: 18, width: 60, height: 12,
          background: C.tape, opacity: 0.85,
          transform:'rotate(-4deg)',
          boxShadow:'0 1px 2px rgba(0,0,0,0.06)',
          backgroundImage:`repeating-linear-gradient(90deg, transparent 0 4px, rgba(0,0,0,0.05) 4px 5px)`,
        }}/>
        {/* Polaroid */}
        <div style={{
          position:'absolute', left: 10, top: 6,
          width: 140, padding:'8px 8px 24px',
          background:'#FBF8EF',
          boxShadow:'0 4px 14px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.06)',
          transform:'rotate(-3deg)',
        }}>
          {/* photo — striped placeholder */}
          <div style={{
            width:'100%', aspectRatio:'1/1',
            background:`
              linear-gradient(135deg, rgba(30,38,96,0.18), transparent 60%),
              repeating-linear-gradient(135deg, #C8B58A 0 4px, #B6A176 4px 8px)
            `,
          }}/>
          <div style={{
            fontFamily:"'Caveat', cursive",
            fontSize: 14, color: C.ink,
            textAlign:'center', marginTop: 6, lineHeight: 1,
          }}>the courtyard</div>
        </div>

        {/* Post-it with Wi-Fi */}
        <div style={{
          position:'absolute', right: 18, top: 4,
          width: 140, padding:'10px 12px 12px',
          background: C.postit, color: C.postitInk,
          boxShadow:'2px 4px 12px rgba(0,0,0,0.10)',
          transform:'rotate(4deg)',
        }}>
          <div style={{
            fontFamily:"'Caveat', cursive",
            fontSize: 18, fontWeight: 700, lineHeight: 1, marginBottom: 5,
          }}>Wi-Fi</div>
          <div style={{
            fontFamily:"'JetBrains Mono', monospace",
            fontSize: 12, fontWeight: 600, lineHeight: 1.35,
          }}>Casa-Bea</div>
          <div style={{
            fontFamily:"'JetBrains Mono', monospace",
            fontSize: 11, marginTop: 2, lineHeight: 1.35,
          }}>pwd · ciao2026</div>
          <div style={{
            fontFamily:"'Caveat', cursive",
            fontSize: 13, marginTop: 6, opacity: 0.75,
          }}>(works on the balcony too)</div>
        </div>

        {/* Luggage tag for door code */}
        <div style={{
          position:'absolute', right: 4, bottom: -8,
          transform:'rotate(-8deg)',
        }}>
          {/* string */}
          <svg width="60" height="40" viewBox="0 0 60 40" style={{
            position:'absolute', top: -22, right: 36,
            pointerEvents:'none',
          }}>
            <path d="M2 2 C 20 10, 40 18, 56 36" stroke={C.ink} strokeWidth="1" fill="none" opacity="0.5"/>
          </svg>
          <div style={{
            width: 110, padding:'8px 10px',
            background: C.tag,
            borderRadius:'4px 4px 18px 18px',
            border:`1px solid rgba(30,38,96,0.18)`,
            boxShadow:'2px 3px 10px rgba(0,0,0,0.10)',
            position:'relative',
          }}>
            {/* punched hole */}
            <div style={{
              position:'absolute', top: 6, left:'50%', transform:'translateX(-50%)',
              width: 10, height: 10, borderRadius:'50%', background: C.paper,
              border:`1px solid rgba(30,38,96,0.25)`,
            }}/>
            <div style={{
              fontFamily:"'JetBrains Mono', monospace",
              fontSize: 8.5, letterSpacing:'0.18em', textTransform:'uppercase',
              color: C.soft, marginTop: 14, textAlign:'center',
            }}>door code</div>
            <div style={{
              fontFamily:"'JetBrains Mono', monospace",
              fontSize: 22, fontWeight: 700, color: C.ink,
              textAlign:'center', letterSpacing:'0.08em', lineHeight: 1.05,
            }}>4419</div>
          </div>
        </div>
      </div>

      {/* Handwritten host note */}
      <div style={{
        padding:'10px 18px 0 44px',
      }}>
        <div style={{
          fontFamily:"'Caveat', cursive",
          fontSize: 19, lineHeight: 1.35, color: C.ink,
        }}>
          Sara — keys in the brass box. Push hard, the latch sticks!
          <br/>
          Bakery on the corner opens at 7 — try the maritozzo. xxx
        </div>
        <div style={{
          fontFamily:"'Caveat', cursive",
          fontSize: 22, color: C.redPen,
          marginTop: 2, lineHeight: 1,
        }}>— Beatrice</div>
      </div>

      {/* Stamped times card */}
      <div style={{
        margin:'12px 18px 0 44px',
        padding:'10px 14px',
        background:'rgba(255,255,255,0.55)',
        border:`1px dashed rgba(30,38,96,0.35)`,
        position:'relative',
      }}>
        <div style={{
          display:'grid', gridTemplateColumns:'1fr 1fr', gap: 8,
        }}>
          {[
            { l:'Check-in',  v:'after 15:00' },
            { l:'Check-out', v:'before 11:00' },
          ].map(r => (
            <div key={r.l}>
              <div style={{
                fontFamily:"'JetBrains Mono', monospace",
                fontSize: 8.5, letterSpacing:'0.18em', textTransform:'uppercase',
                color: C.soft, fontWeight: 600,
              }}>{r.l}</div>
              <div style={{
                fontFamily:"'Caveat', cursive",
                fontSize: 20, color: C.ink, fontWeight: 700, lineHeight: 1.05,
              }}>{r.v}</div>
            </div>
          ))}
        </div>
        {/* faded "ARRIVED" stamp */}
        <div style={{
          position:'absolute', right: -6, top: -10,
          fontFamily:"'JetBrains Mono', monospace",
          fontSize: 10, letterSpacing:'0.22em', textTransform:'uppercase',
          color: C.redPen, fontWeight: 700,
          border:`2px solid ${C.redPen}`, padding:'3px 7px',
          transform:'rotate(8deg)', opacity: 0.45, background: C.paper,
        }}>arr.</div>
      </div>

      <div style={{flex:1}}/>

      {/* Bottom — ribbon bookmark tabs */}
      <div style={{
        display:'flex', gap: 6, padding:'10px 14px 14px 38px',
        alignItems:'flex-end',
      }}>
        {[
          { l:'Welcome',  active:true,  color: C.ink },
          { l:'Check-in', color: C.inkSoft },
          { l:'House',    color: C.inkSoft },
          { l:'Around',   color: C.inkSoft },
          { l:'Write',    color: C.redPen },
        ].map(t => (
          <div key={t.l} style={{
            flex:1, textAlign:'center',
            padding: t.active ? '10px 4px 14px' : '8px 4px 10px',
            background: t.active ? '#FBF8EF' : 'rgba(232,228,216,0.7)',
            border:`1px solid rgba(30,38,96,0.18)`,
            borderBottom:'none',
            borderRadius:'4px 4px 0 0',
            boxShadow: t.active ? '0 -2px 6px rgba(0,0,0,0.04)' : 'none',
            fontFamily:"'Caveat', cursive",
            fontSize: 15, fontWeight: t.active ? 700 : 400,
            color: t.color,
            lineHeight: 1, position:'relative',
          }}>
            {t.l}
          </div>
        ))}
      </div>
    </div>
  );
}

window.DiarioMock = DiarioMock;
