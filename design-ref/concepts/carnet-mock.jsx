// CARNET — the app as a boarding pass / travel document.
// Dense, document-like, monospace, perforated edges.
// Navigation = section tabs along the top of the ticket.

function CarnetMock() {
  const C = {
    bg:'#F2EBE0',
    surface:'#FFFFFF',
    ink:'#0A1F3D',
    soft:'#5B6A82',
    accent:'#B22234',
    line:'rgba(10,31,61,0.18)',
    dash:'rgba(10,31,61,0.40)',
    stub:'#E8DFCD',
  };

  const Field = ({ label, value, sub, mono = true }) => (
    <div>
      <div style={{
        fontFamily:"'JetBrains Mono', monospace",
        fontSize: 8.5, letterSpacing:'0.22em', textTransform:'uppercase',
        color: C.soft, fontWeight: 600, marginBottom: 4,
      }}>{label}</div>
      <div style={{
        fontFamily: mono ? "'JetBrains Mono', monospace" : "'Tenor Sans', sans-serif",
        fontSize: mono ? 14 : 17,
        fontWeight: mono ? 700 : 400,
        color: C.ink, letterSpacing: mono ? '-0.01em' : '0.01em',
        lineHeight: 1.05,
      }}>{value}</div>
      {sub ? (
        <div style={{
          fontFamily:"'Geist', sans-serif", fontSize: 10,
          color: C.soft, marginTop: 3,
        }}>{sub}</div>
      ) : null}
    </div>
  );

  return (
    <div style={{
      width:'100%', height:'100%',
      background: C.bg,
      color: C.ink,
      fontFamily:"'Geist', system-ui, sans-serif",
      display:'flex', flexDirection:'column',
      padding: 14,
      overflow:'hidden',
      boxSizing:'border-box',
      position:'relative',
    }}>
      {/* Top utility row */}
      <div style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        fontFamily:"'JetBrains Mono', monospace",
        fontSize: 9, letterSpacing:'0.2em', textTransform:'uppercase',
        color: C.soft, marginBottom: 10, padding:'0 4px',
      }}>
        <span>WBnB · Welcome pass</span>
        <span>EN<span style={{margin:'0 4px', opacity:0.4}}>·</span>it</span>
      </div>

      {/* THE TICKET */}
      <div style={{
        flex: 1, position:'relative',
        background: C.surface,
        border: `1.5px solid ${C.ink}`,
        borderRadius: 4,
        display:'flex', flexDirection:'column',
        overflow:'hidden',
      }}>
        {/* Tab strip */}
        <div style={{
          display:'flex', borderBottom: `1.5px solid ${C.ink}`,
          background: C.stub,
        }}>
          {[
            { l:'Welcome', active:true },
            { l:'Check-in' },
            { l:'House' },
            { l:'Near' },
            { l:'Talk' },
          ].map(t => (
            <div key={t.l} style={{
              flex:1, padding:'8px 4px', textAlign:'center',
              borderRight: `1px solid ${C.line}`,
              background: t.active ? C.surface : 'transparent',
              fontFamily:"'JetBrains Mono', monospace",
              fontSize: 9.5, letterSpacing:'0.18em', textTransform:'uppercase',
              fontWeight: t.active ? 700 : 500,
              color: t.active ? C.ink : C.soft,
              position:'relative',
            }}>
              {t.l}
              {t.active && (
                <div style={{
                  position:'absolute', left: 0, right: 0, bottom: -1.5,
                  height: 2, background: C.accent,
                }}/>
              )}
            </div>
          ))}
        </div>

        {/* Header band */}
        <div style={{
          padding:'14px 18px 14px',
          borderBottom: `1px dashed ${C.dash}`,
          display:'flex', justifyContent:'space-between', alignItems:'flex-start',
          gap: 12,
        }}>
          <div style={{flex:1, minWidth: 0}}>
            <div style={{
              fontFamily:"'JetBrains Mono', monospace",
              fontSize: 8.5, letterSpacing:'0.22em', textTransform:'uppercase',
              color: C.soft, marginBottom: 5, fontWeight: 600,
            }}>Property</div>
            <div style={{
              fontFamily:"'Tenor Sans', sans-serif",
              fontSize: 22, lineHeight: 1, letterSpacing:'0.005em',
              color: C.ink,
            }}>Casa di Beatrice</div>
            <div style={{
              fontFamily:"'Geist', sans-serif", fontSize: 11,
              color: C.soft, marginTop: 6,
            }}>Vicolo del Cinque 11 · Trastevere · Roma</div>
          </div>
          <div style={{
            width: 56, textAlign:'center',
            border:`1.5px solid ${C.ink}`,
            padding:'6px 4px 4px',
          }}>
            <div style={{
              fontFamily:"'Tenor Sans', sans-serif",
              fontSize: 16, color: C.ink, lineHeight: 1,
            }}>WBnB</div>
            <div style={{
              fontFamily:"'JetBrains Mono', monospace",
              fontSize: 7, letterSpacing:'0.18em',
              color: C.soft, marginTop: 2, fontWeight: 600,
            }}>EST · 2025</div>
          </div>
        </div>

        {/* From → To */}
        <div style={{
          padding:'14px 18px',
          display:'grid', gridTemplateColumns:'1fr auto 1fr', gap: 12, alignItems:'flex-end',
          borderBottom: `1px dashed ${C.dash}`,
        }}>
          <Field label="Guest" value="SARA MÜLLER" sub="Booking · 3 nights" />
          <div style={{
            fontFamily:"'JetBrains Mono', monospace",
            fontSize: 16, color: C.accent, fontWeight: 700,
            alignSelf:'center', paddingBottom: 2,
          }}>→</div>
          <Field label="Arrives" value="26 MAY · 15:30" sub="Today" />
        </div>

        {/* Field grid */}
        <div style={{
          padding:'14px 18px 16px',
          display:'grid', gridTemplateColumns: '1fr 1fr', rowGap: 14, columnGap: 18,
          borderBottom: `1px dashed ${C.dash}`,
        }}>
          <Field label="Wi-Fi" value="Casa-Bea" sub="pwd · ciao2026" />
          <Field label="Door code" value="4419" sub="Brass box, left of door" />
          <Field label="Check-in" value="≥ 15:00" sub="Self · keybox" />
          <Field label="Check-out" value="≤ 11:00" sub="Leave keys in box" />
        </div>

        {/* Note from host */}
        <div style={{
          padding:'14px 18px',
          borderBottom: `1px dashed ${C.dash}`,
          flex: 1, minHeight: 0,
        }}>
          <div style={{
            fontFamily:"'JetBrains Mono', monospace",
            fontSize: 8.5, letterSpacing:'0.22em', textTransform:'uppercase',
            color: C.soft, fontWeight: 600, marginBottom: 6,
          }}>Note from your host</div>
          <div style={{
            fontFamily:"'Tenor Sans', sans-serif",
            fontSize: 13.5, lineHeight: 1.5, color: C.ink,
            letterSpacing:'0.005em',
          }}>
            Bakery on the corner — 7am, ask for a maritozzo. The latch sticks; push hard. Anything at all, message us.
          </div>
          <div style={{
            fontFamily:"'Geist', sans-serif", fontSize: 11,
            color: C.soft, marginTop: 8,
          }}>— Beatrice &amp; Marco</div>
        </div>

        {/* STUB */}
        <div style={{
          padding:'12px 18px',
          background: C.stub,
          display:'flex', alignItems:'center', justifyContent:'space-between',
          position:'relative',
        }}>
          {/* notches */}
          <div style={{
            position:'absolute', top: -8, left: -8, width: 16, height: 16,
            borderRadius:'50%', background: C.bg,
            border:`1.5px solid ${C.ink}`,
          }}/>
          <div style={{
            position:'absolute', top: -8, right: -8, width: 16, height: 16,
            borderRadius:'50%', background: C.bg,
            border:`1.5px solid ${C.ink}`,
          }}/>

          <div>
            <div style={{
              fontFamily:"'JetBrains Mono', monospace",
              fontSize: 8.5, letterSpacing:'0.22em', textTransform:'uppercase',
              color: C.soft, fontWeight: 600, marginBottom: 4,
            }}>Booking · Confirmed</div>
            <div style={{
              fontFamily:"'JetBrains Mono', monospace",
              fontSize: 16, fontWeight: 700, color: C.ink,
              letterSpacing:'0.08em',
            }}>WBNB · 9KX2M4</div>
          </div>
          {/* QR-ish pattern */}
          <div style={{
            width: 54, height: 54,
            display:'grid',
            gridTemplateColumns:'repeat(9, 1fr)',
            gridTemplateRows:'repeat(9, 1fr)',
            gap: 1, background: C.ink, padding: 2,
          }}>
            {Array.from({length:81}).map((_,i) => {
              // pseudo random pattern
              const r = ((i * 31 + 7) % 11) > 4;
              return <div key={i} style={{background: r ? C.ink : C.surface}}/>;
            })}
          </div>
        </div>

        {/* CONFIRMED stamp overlay */}
        <div style={{
          position:'absolute', top: 92, right: 18,
          fontFamily:"'JetBrains Mono', monospace",
          fontSize: 11, letterSpacing:'0.22em', textTransform:'uppercase',
          color: C.accent, fontWeight: 700,
          border:`2.5px solid ${C.accent}`,
          padding:'5px 10px',
          transform:'rotate(-10deg)',
          opacity: 0.35,
          pointerEvents:'none',
        }}>Confirmed</div>
      </div>

      {/* Bottom utility */}
      <div style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        fontFamily:"'JetBrains Mono', monospace",
        fontSize: 8.5, letterSpacing:'0.2em', textTransform:'uppercase',
        color: C.soft, marginTop: 10, padding:'0 4px',
      }}>
        <span>Issued · 25 may 2026</span>
        <span style={{color: C.accent, fontWeight: 700}}>112 · Emergency</span>
      </div>
    </div>
  );
}

window.CarnetMock = CarnetMock;
