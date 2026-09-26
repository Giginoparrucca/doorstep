// Phone-sized welcome screen mockup. Reskins to whatever theme is passed.

function WelcomeMock({ theme }) {
  const { palette, font, hero } = theme;
  const accentStrong = palette.accentStrong || palette.accent;

  // Icon stroke color depending on theme
  const stroke = palette.iconStroke || palette.ink;

  const Icon = ({ d, size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );

  const navItems = [
    { label: 'Home',     d: 'M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-7H10v7H6a2 2 0 0 1-2-2v-9z', active: true },
    { label: 'Check-in', d: 'M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11' },
    { label: 'Rules',    d: 'M4 5h16M4 12h16M4 19h10' },
    { label: 'Explore',  d: 'M12 22s8-7 8-13a8 8 0 1 0-16 0c0 6 8 13 8 13z M12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z' },
    { label: 'Chat',     d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10z' },
  ];

  return (
    <div style={{
      width:'100%', height:'100%',
      background: palette.bg,
      color: palette.ink,
      fontFamily: font.body,
      display:'flex', flexDirection:'column',
      overflow:'hidden',
      boxSizing:'border-box',
      position:'relative',
    }}>
      {/* Top bar */}
      <div style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'14px 18px 10px',
        background: palette.bg,
        borderBottom: `1px solid ${palette.line}`,
      }}>
        <div style={{
          fontFamily: font.display,
          fontSize: 16, fontWeight: font.displayWeight || 500,
          fontStyle: font.displayItalic ? 'italic' : 'normal',
          letterSpacing: font.displayTracking || '-0.005em',
        }}>{hero.property}</div>
        <div style={{
          display:'flex', alignItems:'center', gap: 0,
          background: palette.surface,
          border: `1px solid ${palette.line}`,
          borderRadius: 999, padding: 3,
          fontFamily:'JetBrains Mono, monospace',
        }}>
          <div style={{padding:'3px 10px', borderRadius:999, fontSize:10, letterSpacing:'0.1em', fontWeight:600, background: palette.accent, color: palette.accentInk}}>EN</div>
          <div style={{padding:'3px 10px', borderRadius:999, fontSize:10, letterSpacing:'0.1em', fontWeight:500, color: palette.soft}}>IT</div>
        </div>
      </div>

      {/* Hero */}
      <div style={{
        position:'relative', height: 220, overflow:'hidden',
        background: hero.heroBg,
      }}>
        {/* Decorative stripes */}
        <div style={{
          position:'absolute', inset: 0,
          backgroundImage: `repeating-linear-gradient(135deg, ${hero.stripe} 0 1px, transparent 1px 16px)`,
          opacity: 0.35,
        }} />
        <div style={{
          position:'absolute', inset: 0,
          background: hero.heroOverlay,
        }} />
        <div style={{
          position:'absolute', bottom: 16, left: 18, right: 18, color: hero.heroText,
        }}>
          <div style={{
            display:'inline-flex', alignItems:'center', gap:6,
            fontFamily:'JetBrains Mono, monospace', fontSize: 9.5,
            letterSpacing:'0.18em', textTransform:'uppercase',
            padding:'4px 10px', borderRadius: 999,
            background: hero.badgeBg, color: hero.heroText,
            border: `1px solid ${hero.badgeBorder}`,
            marginBottom: 8,
          }}>
            <span style={{width:5, height:5, borderRadius:'50%', background: palette.accentStrong || palette.accent, display:'inline-block'}} />
            Arriving today
          </div>
          <div style={{
            fontFamily: font.display,
            fontSize: 30, lineHeight: 1.05,
            fontWeight: font.displayWeight || 400,
            fontStyle: font.displayItalic ? 'italic' : 'normal',
            letterSpacing: font.displayTracking || '-0.01em',
          }}>
            Welcome,{' '}
            <span style={{
              fontStyle: 'italic',
              color: hero.heroAccent,
              fontWeight: font.displayWeight || 400,
            }}>Beatrice</span>
          </div>
          <div style={{
            fontFamily: font.body, fontSize: 11.5,
            color: hero.heroSub, marginTop: 2, fontWeight: 300,
          }}>Trastevere · Roma · 3 nights</div>
        </div>
      </div>

      {/* Quick cards grid */}
      <div style={{
        padding: '14px 14px 0',
        display:'grid', gridTemplateColumns:'1fr 1fr', gap: 10,
      }}>
        {[
          { label:'Wi-Fi', value:'Casa-Bea', sub:'pwd · ciao2026', d: 'M5 12a10 10 0 0 1 14 0 M8.5 15.5a5 5 0 0 1 7 0 M12 19h.01' },
          { label:'Address', value:'Vicolo del Cinque 11', sub:'00153 Roma', d: 'M12 22s8-7 8-13a8 8 0 1 0-16 0c0 6 8 13 8 13z M12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z' },
          { label:'Check-in', value:'After 15:00', sub:'Self check-in · keybox', d: 'M15 7h2a4 4 0 0 1 0 8h-2 M9 17H7a4 4 0 0 1 0-8h2 M8 12h8' },
          { label:'Check-out', value:'Before 11:00', sub:'Leave keys in the box', d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9' },
        ].map((c, i) => (
          <div key={i} style={{
            background: palette.surface,
            border: `1px solid ${palette.line}`,
            borderRadius: 12,
            padding: '12px 12px 14px',
          }}>
            <div style={{
              display:'flex', alignItems:'center', justifyContent:'space-between',
              marginBottom: 8,
            }}>
              <Icon d={c.d} size={15} />
              <div style={{
                fontFamily:'JetBrains Mono, monospace', fontSize: 8.5,
                letterSpacing:'0.18em', textTransform:'uppercase',
                color: palette.soft,
              }}>{c.label}</div>
            </div>
            <div style={{
              fontFamily: font.display, fontSize: 15.5,
              fontWeight: font.displayWeight || 500,
              fontStyle: font.displayItalic ? 'italic' : 'normal',
              letterSpacing: '-0.005em',
              color: palette.ink,
              lineHeight: 1.15,
            }}>{c.value}</div>
            <div style={{
              fontFamily: font.body, fontSize: 10.5,
              color: palette.soft, marginTop: 4, fontWeight: 400,
            }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Host message */}
      <div style={{
        margin: '14px 14px 10px',
        padding: '14px 14px',
        background: palette.surface,
        border: `1px solid ${palette.line}`,
        borderRadius: 12,
      }}>
        <div style={{display:'flex', alignItems:'center', gap: 10, marginBottom: 10}}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            background: palette.accent, color: palette.accentInk,
            display:'flex', alignItems:'center', justifyContent:'center',
            fontFamily: font.display, fontSize: 16,
            fontWeight: font.displayWeight || 500,
            fontStyle: font.displayItalic ? 'italic' : 'normal',
          }}>B</div>
          <div style={{flex:1}}>
            <div style={{fontFamily: font.body, fontSize: 12.5, fontWeight: 500, color: palette.ink}}>Beatrice &amp; Marco</div>
            <div style={{fontFamily:'JetBrains Mono, monospace', fontSize: 8.5, letterSpacing:'0.16em', textTransform:'uppercase', color: palette.soft, marginTop: 1}}>Your hosts</div>
          </div>
          <Icon d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10z" size={16} />
        </div>
        <div style={{
          fontFamily: font.body, fontSize: 12.5, lineHeight: 1.55,
          color: palette.ink, opacity: 0.85, fontWeight: 300,
        }}>
          The bakery on the corner opens at 7 — try the maritozzo. Keys are in the brass box by the door, code <span style={{fontFamily:'JetBrains Mono, monospace', background: palette.accent, color: palette.accentInk, padding:'0 5px', borderRadius: 3, fontWeight: 500}}>4419</span>.
        </div>
      </div>

      {/* Emergency strip */}
      <div style={{
        margin: '0 14px 14px',
        padding: '10px 12px',
        background: palette.dangerBg,
        border: `1px solid ${palette.dangerLine}`,
        borderRadius: 10,
        display:'flex', alignItems:'center', gap: 10,
      }}>
        <div style={{
          width: 6, height: 6, borderRadius:'50%',
          background: palette.danger,
        }} />
        <div style={{flex:1, fontFamily:'JetBrains Mono, monospace', fontSize: 9.5, letterSpacing:'0.18em', textTransform:'uppercase', color: palette.danger, fontWeight: 600}}>Emergency</div>
        <div style={{fontFamily: font.body, fontSize: 12, color: palette.ink, fontWeight: 500}}>112</div>
      </div>

      <div style={{flex:1}} />

      {/* Bottom nav */}
      <div style={{
        display:'flex', alignItems:'stretch',
        background: palette.surface,
        borderTop: `1px solid ${palette.line}`,
        height: 58,
      }}>
        {navItems.map(n => (
          <div key={n.label} style={{
            flex:1, display:'flex', flexDirection:'column',
            alignItems:'center', justifyContent:'center', gap: 3,
            color: n.active ? (palette.accentStrong || palette.accent) : palette.soft,
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d={n.d} />
            </svg>
            <div style={{
              fontFamily:'JetBrains Mono, monospace', fontSize: 8,
              letterSpacing:'0.14em', textTransform:'uppercase', fontWeight: n.active ? 600 : 500,
            }}>{n.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

window.WelcomeMock = WelcomeMock;
