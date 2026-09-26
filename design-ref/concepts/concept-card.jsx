// Concept card — manifesto + tiny palette dots + type pair line + bullets.
// Used at the start of each section.

function ConceptCard({ concept }) {
  const { id, name, tagline, manifesto, palette, font, bullets } = concept;

  return (
    <div style={{
      width:'100%', height:'100%',
      background: palette.bg,
      color: palette.ink,
      padding: '36px 38px',
      display:'flex', flexDirection:'column',
      fontFamily: font.body,
      boxSizing:'border-box',
    }}>
      {/* Eyebrow */}
      <div style={{
        display:'flex', alignItems:'baseline', gap: 14,
        marginBottom: 18,
      }}>
        <div style={{
          fontFamily:'JetBrains Mono, monospace',
          fontSize: 10.5, letterSpacing:'0.22em', textTransform:'uppercase',
          color: palette.soft, fontWeight: 500,
        }}>Concept {id}</div>
        <div style={{flex:1, height:1, background: palette.ink, opacity:0.15}} />
        <div style={{
          fontFamily:'JetBrains Mono, monospace',
          fontSize: 10.5, letterSpacing:'0.22em', textTransform:'uppercase',
          color: palette.soft, fontWeight: 500,
        }}>{font.pair}</div>
      </div>

      {/* Name */}
      <div style={{
        fontFamily: font.display,
        fontSize: 96, lineHeight: 0.92, fontWeight: font.displayWeight || 400,
        letterSpacing: font.displayTracking || '-0.02em',
        fontStyle: font.displayItalic ? 'italic' : 'normal',
        marginBottom: 6,
      }}>{name}</div>

      <div style={{
        fontFamily: font.body, fontSize: 16, color: palette.soft,
        fontWeight: 400, marginBottom: 24,
      }}>{tagline}</div>

      {/* Manifesto */}
      <div style={{
        fontFamily: font.body, fontSize: 14.5, lineHeight: 1.6,
        color: palette.ink, opacity: 0.86, maxWidth: 580,
        marginBottom: 28, fontWeight: 400,
      }}>{manifesto}</div>

      {/* Bullets */}
      <div style={{
        display:'grid', gridTemplateColumns:'auto 1fr', gap:'14px 16px',
        marginBottom: 28,
      }}>
        {bullets.map((b, i) => (
          <React.Fragment key={i}>
            <div style={{
              fontFamily:'JetBrains Mono, monospace',
              fontSize: 10.5, letterSpacing:'0.16em', textTransform:'uppercase',
              color: palette.accent, fontWeight: 600, paddingTop: 3,
            }}>{b.label}</div>
            <div style={{fontSize: 13.5, lineHeight: 1.55, color: palette.ink, fontWeight: 400}}>{b.text}</div>
          </React.Fragment>
        ))}
      </div>

      <div style={{flex:1}} />

      {/* Palette row */}
      <div style={{
        display:'flex', alignItems:'center', gap: 14,
        paddingTop: 18, borderTop: `1px solid ${palette.ink}22`,
      }}>
        <div style={{
          fontFamily:'JetBrains Mono, monospace',
          fontSize: 9.5, letterSpacing:'0.18em', textTransform:'uppercase',
          color: palette.soft, fontWeight: 500,
        }}>Palette</div>
        <div style={{display:'flex', gap: 8}}>
          {palette.swatches.map(s => (
            <div key={s.hex} title={`${s.name} ${s.hex}`} style={{
              width: 28, height: 28, borderRadius:'50%',
              background: s.hex,
              border: s.border ? `1px solid ${s.border}` : 'none',
            }} />
          ))}
        </div>
        <div style={{flex:1}} />
        <div style={{
          fontFamily:'JetBrains Mono, monospace',
          fontSize: 10, letterSpacing:'0.06em',
          color: palette.soft,
        }}>{palette.swatches.map(s => s.hex).join('  ·  ')}</div>
      </div>
    </div>
  );
}

window.ConceptCard = ConceptCard;
