// Palette card — name, manifesto, swatches with hex codes.
// Receives a `theme` object describing the direction.

function PaletteCard({ theme }) {
  const { id, name, tagline, manifesto, palette, font } = theme;
  return (
    <div style={{
      width: '100%', height: '100%',
      background: palette.bg,
      color: palette.ink,
      padding: '40px 44px',
      display: 'flex', flexDirection: 'column',
      fontFamily: font.body,
      boxSizing: 'border-box',
    }}>
      <div style={{
        display:'flex', alignItems:'baseline', gap: 14,
        marginBottom: 6,
      }}>
        <div style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 11, letterSpacing: '0.22em', textTransform:'uppercase',
          color: palette.soft, fontWeight: 500,
        }}>Direction {id}</div>
        <div style={{
          flex:1, height:1, background: palette.softLine || 'currentColor', opacity: 0.18,
        }} />
        <div style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 11, letterSpacing: '0.22em', textTransform:'uppercase',
          color: palette.soft, fontWeight: 500,
        }}>Palette · Type</div>
      </div>

      <div style={{
        fontFamily: font.display,
        fontSize: 88, lineHeight: 0.95, fontWeight: font.displayWeight || 400,
        letterSpacing: font.displayTracking || '-0.01em',
        fontStyle: font.displayItalic ? 'italic' : 'normal',
        marginTop: 14, marginBottom: 8,
      }}>{name}</div>

      <div style={{
        fontFamily: font.body,
        fontSize: 16, color: palette.soft, fontWeight: 400,
        letterSpacing: '0.01em', marginBottom: 22,
      }}>{tagline}</div>

      <div style={{
        fontFamily: font.body, fontSize: 14.5, lineHeight: 1.55,
        color: palette.ink, opacity: 0.82,
        maxWidth: 620, marginBottom: 32, fontWeight: 300,
      }}>{manifesto}</div>

      <div style={{ flex: 1 }} />

      {/* Swatch row */}
      <div style={{
        display:'grid',
        gridTemplateColumns: `repeat(${palette.swatches.length}, 1fr)`,
        gap: 10,
      }}>
        {palette.swatches.map(s => (
          <div key={s.hex} style={{
            display:'flex', flexDirection:'column', gap: 8,
          }}>
            <div style={{
              height: 86, borderRadius: 6,
              background: s.hex,
              border: s.border ? `1px solid ${s.border}` : 'none',
              boxShadow: s.shadow || 'none',
            }} />
            <div style={{
              fontFamily:'JetBrains Mono, monospace',
              fontSize: 10.5, letterSpacing:'0.08em',
              color: palette.soft, textTransform:'uppercase',
            }}>{s.name}</div>
            <div style={{
              fontFamily:'JetBrains Mono, monospace',
              fontSize: 11.5, color: palette.ink, fontWeight: 500,
            }}>{s.hex}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

window.PaletteCard = PaletteCard;
