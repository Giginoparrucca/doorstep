// ATLANTE — the app as a map. Property is a pin, content lives in a
// bottom sheet drawer. Navigation is gestural — floating FABs and a
// pull-up handle, not tabs.

function AtlanteMock() {
  // Stylized Trastevere-ish map. Just a few colored strokes that read as
  // streets / river / piazza. Not a real map.
  const C = {
    land:'#EAE4D7',
    block:'#E0D9C7',
    park:'#C8D4AA',
    water:'#B7CFDB',
    road:'#FFFFFF',
    pinRed:'#E11D48',
    pinSoft:'#FCA5B2',
    ink:'#1A1A1A',
    soft:'#6B6B6B',
    surface:'#FFFFFF',
    line:'rgba(26,26,26,0.10)',
  };

  return (
    <div style={{
      width:'100%', height:'100%',
      background: C.land,
      color: C.ink,
      fontFamily:"'Geist', system-ui, sans-serif",
      display:'flex', flexDirection:'column',
      overflow:'hidden',
      position:'relative',
      boxSizing:'border-box',
    }}>
      {/* MAP layer (full-bleed) */}
      <svg viewBox="0 0 360 720" style={{
        position:'absolute', inset: 0, width:'100%', height:'100%',
      }} preserveAspectRatio="xMidYMid slice">
        {/* land */}
        <rect width="360" height="720" fill={C.land}/>
        {/* river — diagonal blue band */}
        <path d="M -20 80 C 60 140, 80 220, 180 280 S 360 380, 380 460 L 380 800 L -20 800 Z" fill={C.water}/>
        {/* park */}
        <path d="M 70 470 C 110 460, 160 470, 180 510 S 130 580, 80 560 S 40 510, 70 470 Z" fill={C.park}/>
        {/* a few city blocks (rounded rects) */}
        {[
          [40,160,80,60],[140,140,70,50],[230,170,90,65],
          [50,260,70,55],[140,250,90,70],[250,270,70,55],
          [40,360,80,55],[140,360,75,70],[235,365,85,55],
          [220,500,90,70],[230,590,80,60],[140,610,70,55],
          [40,610,80,60],
        ].map(([x,y,w,h],i) => (
          <rect key={i} x={x} y={y} width={w} height={h} rx="3"
            fill={C.block} stroke={C.land} strokeWidth="1"/>
        ))}
        {/* streets */}
        {[
          'M 0 230 L 360 230','M 0 340 L 360 340','M 0 450 L 240 450','M 0 580 L 360 580',
          'M 120 0 L 120 720','M 220 0 L 220 460','M 320 0 L 320 720',
        ].map((d,i) => (
          <path key={i} d={d} stroke={C.road} strokeWidth="8" strokeLinecap="round" fill="none"/>
        ))}
        {/* secondary streets */}
        {[
          'M 0 130 L 220 130','M 0 290 L 360 290','M 0 410 L 360 410','M 0 510 L 360 510','M 0 660 L 360 660',
          'M 60 0 L 60 230','M 180 130 L 180 720','M 280 230 L 280 720',
        ].map((d,i) => (
          <path key={i} d={d} stroke={C.road} strokeWidth="4" strokeLinecap="round" fill="none"/>
        ))}
        {/* piazza dot */}
        <circle cx="180" cy="290" r="14" fill={C.road} stroke={C.line} strokeWidth="1"/>
        {/* small reco pins (numbered) */}
        {[
          {x:90,  y:190, n:1},
          {x:260, y:220, n:2},
          {x:300, y:380, n:3},
          {x:90,  y:530, n:4},
        ].map(p => (
          <g key={p.n}>
            <circle cx={p.x} cy={p.y} r="11" fill={C.surface} stroke={C.ink} strokeWidth="1.5"/>
            <text x={p.x} y={p.y+3.5} textAnchor="middle"
              fontFamily="JetBrains Mono, monospace" fontSize="10" fontWeight="700" fill={C.ink}>{p.n}</text>
          </g>
        ))}
      </svg>

      {/* Big property pin (centered-ish on a block) */}
      <div style={{
        position:'absolute', left:'50%', top:'40%',
        transform:'translate(-50%, -100%)',
        display:'flex', flexDirection:'column', alignItems:'center',
        pointerEvents:'none',
      }}>
        <div style={{
          padding:'5px 12px 6px',
          background: C.ink, color:'#FFF',
          borderRadius: 8,
          fontFamily:"'Geist', sans-serif", fontSize: 11.5, fontWeight: 600,
          letterSpacing:'-0.005em', marginBottom: 6,
          whiteSpace:'nowrap',
          boxShadow:'0 4px 14px rgba(0,0,0,0.18)',
        }}>Casa di Beatrice</div>
        <div style={{
          width: 0, height: 0,
          borderLeft:'6px solid transparent',
          borderRight:'6px solid transparent',
          borderTop:`8px solid ${C.ink}`,
          marginTop:-2,
        }}/>
        {/* pin head */}
        <div style={{
          width: 30, height: 30, borderRadius:'50%',
          background: C.pinRed,
          border:'3px solid #FFF',
          boxShadow:'0 4px 14px rgba(225,29,72,0.45)',
        }}/>
        <div style={{
          width: 4, height: 4, borderRadius:'50%',
          background: C.ink, marginTop: 2, opacity: 0.4,
          boxShadow:'0 0 0 6px rgba(0,0,0,0.04)',
        }}/>
      </div>

      {/* Top floating pill */}
      <div style={{
        position:'absolute', top: 14, left: 14, right: 14,
        display:'flex', justifyContent:'space-between', alignItems:'center',
        gap: 8, zIndex: 3,
      }}>
        <div style={{
          background: C.surface,
          padding:'8px 14px 8px 10px',
          borderRadius: 999,
          boxShadow:'0 4px 14px rgba(0,0,0,0.08)',
          display:'flex', alignItems:'center', gap: 8,
          fontFamily:"'Geist', sans-serif", fontSize: 12, fontWeight: 500,
        }}>
          <div style={{
            width: 22, height: 22, borderRadius:'50%',
            background: C.pinRed, color:'#FFF',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize: 13, fontWeight: 600,
          }}>S</div>
          Ciao, Sara — <span style={{color:C.soft, fontWeight:400}}>arrive in 3h</span>
        </div>
        <div style={{
          background: C.surface,
          padding:'7px 4px', borderRadius: 999,
          boxShadow:'0 4px 14px rgba(0,0,0,0.08)',
          display:'flex',
          fontFamily:"'JetBrains Mono', monospace",
          fontSize: 10, letterSpacing:'0.1em', fontWeight: 600,
        }}>
          <span style={{padding:'2px 8px', background: C.ink, color:'#FFF', borderRadius: 999}}>EN</span>
          <span style={{padding:'2px 8px', color: C.soft}}>IT</span>
        </div>
      </div>

      {/* Floating FABs (right) */}
      <div style={{
        position:'absolute', right: 14, bottom: 360,
        display:'flex', flexDirection:'column', gap: 10, zIndex: 3,
      }}>
        {[
          {d:'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10z', primary:true},
          {d:'M5 12a10 10 0 0 1 14 0 M8.5 15.5a5 5 0 0 1 7 0 M12 19h.01'},
          {d:'M12 2v4 M12 18v4 M4.93 4.93l2.83 2.83 M16.24 16.24l2.83 2.83 M2 12h4 M18 12h4 M4.93 19.07l2.83-2.83 M16.24 7.76l2.83-2.83'},
        ].map((b, i) => (
          <div key={i} style={{
            width: 44, height: 44, borderRadius:'50%',
            background: b.primary ? C.pinRed : C.surface,
            color: b.primary ? '#FFF' : C.ink,
            display:'flex', alignItems:'center', justifyContent:'center',
            boxShadow: b.primary
              ? '0 6px 18px rgba(225,29,72,0.45)'
              : '0 4px 14px rgba(0,0,0,0.10)',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d={b.d}/>
            </svg>
          </div>
        ))}
      </div>

      {/* Bottom sheet */}
      <div style={{
        position:'absolute', left: 0, right: 0, bottom: 0,
        background: C.surface,
        borderTopLeftRadius: 22, borderTopRightRadius: 22,
        boxShadow:'0 -6px 28px rgba(0,0,0,0.10)',
        padding:'10px 18px 18px',
        zIndex: 4,
      }}>
        {/* Handle */}
        <div style={{
          width: 38, height: 4, background:'rgba(0,0,0,0.18)',
          borderRadius: 2, margin:'0 auto 14px',
        }}/>

        {/* Title row */}
        <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom: 4}}>
          <div style={{
            fontFamily:"'Bricolage Grotesque', sans-serif",
            fontSize: 22, fontWeight: 600, letterSpacing:'-0.02em', lineHeight: 1,
          }}>Casa di Beatrice</div>
          <div style={{
            fontFamily:"'JetBrains Mono', monospace",
            fontSize: 10, color: C.soft, letterSpacing:'0.06em',
          }}>41.8895°N · 12.4684°E</div>
        </div>
        <div style={{
          fontFamily:"'Geist', sans-serif", fontSize: 12, color: C.soft,
          marginBottom: 14,
        }}>Trastevere · 3 nights · with Beatrice &amp; Marco</div>

        {/* Inline info chips */}
        <div style={{
          display:'grid', gridTemplateColumns:'1fr 1fr', gap: 8,
          marginBottom: 12,
        }}>
          {[
            {l:'Wi-Fi', v:'Casa-Bea', s:'ciao2026'},
            {l:'Door', v:'4419', s:'brass box, left'},
            {l:'Arrive', v:'15:00 →', s:'self check-in'},
            {l:'Depart', v:'→ 11:00', s:'keys in box'},
          ].map(c => (
            <div key={c.l} style={{
              padding:'9px 11px', background:'#F6F4EF',
              border:`1px solid ${C.line}`, borderRadius: 10,
            }}>
              <div style={{
                fontFamily:"'JetBrains Mono', monospace", fontSize: 9,
                letterSpacing:'0.18em', textTransform:'uppercase',
                color: C.soft, fontWeight: 600, marginBottom: 3,
              }}>{c.l}</div>
              <div style={{
                fontFamily:"'Bricolage Grotesque', sans-serif",
                fontSize: 14, fontWeight: 600, letterSpacing:'-0.01em',
                color: C.ink, lineHeight: 1.1,
              }}>{c.v}</div>
              <div style={{
                fontFamily:"'Geist', sans-serif", fontSize: 10.5,
                color: C.soft, marginTop: 2,
              }}>{c.s}</div>
            </div>
          ))}
        </div>

        {/* Recommendations preview */}
        <div style={{
          display:'flex', alignItems:'center', gap: 10,
          padding:'10px 12px', background: C.ink, color:'#FFF',
          borderRadius: 12,
        }}>
          <div style={{
            display:'flex', gap: -6,
          }}>
            {[1,2,3,4].map(n => (
              <div key={n} style={{
                width: 22, height: 22, borderRadius:'50%',
                background: C.surface, color: C.ink,
                display:'flex', alignItems:'center', justifyContent:'center',
                fontFamily:"'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700,
                marginLeft: n === 1 ? 0 : -6,
                border: `1.5px solid ${C.ink}`,
              }}>{n}</div>
            ))}
          </div>
          <div style={{flex:1, marginLeft: 4}}>
            <div style={{
              fontFamily:"'Bricolage Grotesque', sans-serif",
              fontSize: 13, fontWeight: 600,
            }}>4 picks from your hosts</div>
            <div style={{
              fontFamily:"'Geist', sans-serif", fontSize: 10.5,
              color:'rgba(255,255,255,0.7)', marginTop: 1,
            }}>Bakery · trattoria · gelato · enoteca</div>
          </div>
          <div style={{
            fontFamily:"'JetBrains Mono', monospace", fontSize: 14, fontWeight: 700,
          }}>→</div>
        </div>
      </div>
    </div>
  );
}

window.AtlanteMock = AtlanteMock;
