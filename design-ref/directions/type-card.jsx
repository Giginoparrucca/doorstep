// Type specimen card — display family + body family + sample usage.

function TypeCard({ theme }) {
  const { palette, font } = theme;
  return (
    <div style={{
      width:'100%', height:'100%',
      background: palette.bg, color: palette.ink,
      padding: '40px 44px',
      display:'flex', flexDirection:'column',
      fontFamily: font.body,
      boxSizing:'border-box',
    }}>
      {/* Display specimen */}
      <div style={{
        fontFamily:'JetBrains Mono, monospace',
        fontSize: 11, letterSpacing:'0.22em', textTransform:'uppercase',
        color: palette.soft, fontWeight: 500, marginBottom: 8,
      }}>Display — {font.displayName}</div>

      <div style={{
        fontFamily: font.display,
        fontSize: 140, lineHeight: 0.9,
        fontWeight: font.displayWeight || 400,
        letterSpacing: font.displayTracking || '-0.02em',
        fontStyle: font.displayItalic ? 'italic' : 'normal',
        marginBottom: 4,
      }}>Aa</div>
      <div style={{
        fontFamily: font.display,
        fontSize: 38, lineHeight: 1.05,
        fontWeight: font.displayWeight || 400,
        letterSpacing: font.displayTracking || '-0.01em',
        fontStyle: font.displayItalic ? 'italic' : 'normal',
        marginBottom: 4,
      }}>{font.displaySpecimen || 'Benvenuti a casa'}</div>
      <div style={{
        fontFamily:'JetBrains Mono, monospace',
        fontSize: 10.5, letterSpacing:'0.06em',
        color: palette.soft, marginBottom: 28,
      }}>ABCDEFGHIJKLMN abcdefghijklmn 0123456789</div>

      {/* Divider */}
      <div style={{
        height:1, background: palette.ink, opacity:0.1, marginBottom: 28,
      }} />

      {/* Body specimen */}
      <div style={{
        fontFamily:'JetBrains Mono, monospace',
        fontSize: 11, letterSpacing:'0.22em', textTransform:'uppercase',
        color: palette.soft, fontWeight: 500, marginBottom: 14,
      }}>Body — {font.bodyName}</div>

      <div style={{
        fontFamily: font.body, fontSize: 15.5, lineHeight: 1.55,
        color: palette.ink, fontWeight: 400, marginBottom: 14,
      }}>
        Italian law requires us to register all guests. This takes about two minutes per guest — you can scan your passport with the camera and we'll fill the form automatically.
      </div>

      <div style={{
        display:'grid', gridTemplateColumns:'auto 1fr', gap:'6px 18px',
        fontFamily: font.body, fontSize: 13,
        color: palette.soft, marginTop: 10,
      }}>
        <span style={{fontFamily:'JetBrains Mono, monospace', fontSize: 10.5}}>300</span>
        <span style={{fontWeight: 300, color: palette.ink}}>Light · the quiet voice for body copy</span>
        <span style={{fontFamily:'JetBrains Mono, monospace', fontSize: 10.5}}>400</span>
        <span style={{fontWeight: 400, color: palette.ink}}>Regular · everyday paragraphs &amp; inputs</span>
        <span style={{fontFamily:'JetBrains Mono, monospace', fontSize: 10.5}}>500</span>
        <span style={{fontWeight: 500, color: palette.ink}}>Medium · labels, nav, small UI</span>
        <span style={{fontFamily:'JetBrains Mono, monospace', fontSize: 10.5}}>600</span>
        <span style={{fontWeight: 600, color: palette.ink}}>Semibold · CTAs and emphasis</span>
      </div>

      <div style={{flex:1}} />

      <div style={{
        marginTop: 26, padding: '14px 16px',
        background: palette.surface, borderRadius: 10,
        border: `1px solid ${palette.line}`,
        display:'flex', alignItems:'center', gap: 14,
      }}>
        <div style={{
          width: 38, height: 38, borderRadius: '50%',
          background: palette.accent, color: palette.accentInk,
          display:'flex', alignItems:'center', justifyContent:'center',
          fontFamily: font.display, fontSize: 18, fontWeight: 500,
          fontStyle: font.displayItalic ? 'italic' : 'normal',
        }}>B</div>
        <div style={{flex:1}}>
          <div style={{fontFamily: font.body, fontSize: 13.5, fontWeight: 500, color: palette.ink}}>Beatrice &amp; Marco</div>
          <div style={{fontFamily: font.body, fontSize: 11.5, color: palette.soft, marginTop: 2}}>Your hosts · Trastevere, Roma</div>
        </div>
        <div style={{
          padding:'8px 14px', background: palette.accent, color: palette.accentInk,
          borderRadius: 6, fontSize: 12, fontWeight: 600,
          fontFamily: font.body, letterSpacing:'0.01em',
        }}>Say ciao</div>
      </div>
    </div>
  );
}

window.TypeCard = TypeCard;
