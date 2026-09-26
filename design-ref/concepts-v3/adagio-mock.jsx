// ADAGIO — the app as a timeline of your stay.
// Time is the organising principle. "NOW" is highlighted, past events
// fade, future events stay quiet. Information appears when relevant.

function AdagioMock() {
  const C = {
    bg:'#FBFAF6',
    surface:'#FFFFFF',
    ink:'#0F0F11',
    soft:'#76767F',
    fade:'#B8B8BE',
    accent:'#F26B3A',
    accentBg:'rgba(242,107,58,0.10)',
    accentLine:'rgba(242,107,58,0.30)',
    line:'rgba(15,15,17,0.08)',
    pastBg:'rgba(15,15,17,0.04)',
  };

  // Time row item
  const Row = ({ time, label, body, state = 'future', dot, badge }) => {
    const colors = {
      past:   { time: C.fade,   label: C.fade,   body: C.fade,   dot:'rgba(15,15,17,0.12)' },
      now:    { time: C.accent, label: C.ink,    body: C.ink,    dot: C.accent },
      future: { time: C.ink,    label: C.ink,    body: C.soft,   dot: C.ink },
    }[state];
    return (
      <div style={{
        display:'grid', gridTemplateColumns:'52px 14px 1fr',
        gap: 10, alignItems:'flex-start',
        position:'relative',
      }}>
        {/* Time */}
        <div style={{
          fontFamily:"'JetBrains Mono', monospace",
          fontSize: 12, fontWeight: 700,
          color: colors.time, paddingTop: 1,
          letterSpacing:'-0.01em', textAlign:'right',
        }}>{time}</div>

        {/* Spine + dot */}
        <div style={{position:'relative', height:'100%', display:'flex', justifyContent:'center'}}>
          <div style={{
            position:'absolute', top: 0, bottom: -16, left:'50%',
            width: 1.5, background: C.line, transform:'translateX(-50%)',
          }}/>
          <div style={{
            position:'relative',
            width: state === 'now' ? 12 : 8,
            height: state === 'now' ? 12 : 8,
            borderRadius:'50%',
            background: state === 'now' ? C.accent : C.surface,
            border: state === 'now' ? `none` : `1.5px solid ${colors.dot}`,
            marginTop: 4,
            boxShadow: state === 'now' ? `0 0 0 5px ${C.accentBg}` : 'none',
            flexShrink: 0,
          }}/>
        </div>

        {/* Body */}
        <div style={{paddingBottom: 14}}>
          <div style={{
            fontFamily:"'Bricolage Grotesque', sans-serif",
            fontSize: 13.5, fontWeight: 600, color: colors.label,
            letterSpacing:'-0.01em', lineHeight: 1.2,
            display:'flex', alignItems:'center', gap: 8,
          }}>
            {label}
            {badge && (
              <span style={{
                fontFamily:"'JetBrains Mono', monospace",
                fontSize: 9, letterSpacing:'0.16em',
                background: C.accent, color:'#FFF',
                padding:'2px 6px', borderRadius: 3, fontWeight: 700,
              }}>{badge}</span>
            )}
          </div>
          {body && (
            <div style={{
              fontFamily:"'Geist', sans-serif", fontSize: 11.5,
              color: colors.body, marginTop: 4, lineHeight: 1.5,
            }}>{body}</div>
          )}
        </div>
      </div>
    );
  };

  const DayDivider = ({ day, date }) => (
    <div style={{
      display:'grid', gridTemplateColumns:'52px 14px 1fr', gap: 10,
      alignItems:'center', margin:'2px 0 12px',
    }}>
      <div style={{
        fontFamily:"'JetBrains Mono', monospace",
        fontSize: 8.5, fontWeight: 700, letterSpacing:'0.16em',
        textTransform:'uppercase', color: C.soft, textAlign:'right',
      }}>{day}</div>
      <div/>
      <div style={{
        fontFamily:"'Bricolage Grotesque', sans-serif",
        fontSize: 11.5, fontWeight: 600, color: C.ink,
        letterSpacing:'-0.005em', display:'flex', alignItems:'center', gap: 8,
      }}>
        {date}
        <div style={{flex:1, height:1, background: C.line}}/>
      </div>
    </div>
  );

  return (
    <div style={{
      width:'100%', height:'100%',
      background: C.bg, color: C.ink,
      fontFamily:"'Geist', system-ui, sans-serif",
      display:'flex', flexDirection:'column',
      overflow:'hidden', boxSizing:'border-box',
    }}>
      {/* Header */}
      <div style={{
        padding:'14px 18px 12px',
        borderBottom:`1px solid ${C.line}`,
        background: C.surface,
      }}>
        <div style={{
          display:'flex', alignItems:'baseline', justifyContent:'space-between',
          marginBottom: 8,
        }}>
          <div style={{
            fontFamily:"'JetBrains Mono', monospace",
            fontSize: 9.5, letterSpacing:'0.22em', textTransform:'uppercase',
            color: C.soft, fontWeight: 600,
          }}>Casa di Beatrice · stay</div>
          <div style={{
            fontFamily:"'JetBrains Mono', monospace",
            fontSize: 9.5, letterSpacing:'0.1em', color: C.soft, fontWeight: 500,
          }}>EN · IT</div>
        </div>
        <div style={{
          display:'flex', alignItems:'baseline', gap: 10,
        }}>
          <div style={{
            fontFamily:"'Bricolage Grotesque', sans-serif",
            fontSize: 32, fontWeight: 600, letterSpacing:'-0.025em',
            lineHeight: 1, color: C.ink,
          }}>14:08</div>
          <div style={{
            fontFamily:"'Geist', sans-serif", fontSize: 12,
            color: C.soft, fontWeight: 400,
          }}>Tuesday 26 May · Roma</div>
        </div>
        <div style={{
          display:'flex', alignItems:'center', gap: 8, marginTop: 8,
        }}>
          <div style={{
            padding:'4px 9px', borderRadius: 999,
            background: C.accentBg, color: C.accent,
            fontFamily:"'JetBrains Mono', monospace",
            fontSize: 9.5, fontWeight: 700, letterSpacing:'0.14em',
            border:`1px solid ${C.accentLine}`,
          }}>NOW · ARRIVING IN 2H 52M</div>
        </div>
      </div>

      {/* Timeline */}
      <div style={{
        flex:1, overflow:'hidden',
        padding:'18px 14px 6px',
        background: C.bg,
      }}>
        <DayDivider day="DAY 1" date="Today · 26 May" />

        <Row
          time="13:30"
          state="past"
          label="Booking confirmed"
          body="Beatrice received your booking. Welcome pass sent."
        />
        <Row
          time="14:08"
          state="past"
          label="You opened your stay"
          body=""
        />

        {/* Big "NOW" card */}
        <div style={{
          background: C.surface,
          border:`1.5px solid ${C.accent}`,
          borderRadius: 14,
          padding:'14px 16px 16px',
          margin:'4px 0 16px 0',
          boxShadow:'0 6px 20px rgba(242,107,58,0.12)',
          position:'relative',
        }}>
          <div style={{
            position:'absolute', top: -10, left: 14,
            background: C.accent, color:'#FFF',
            fontFamily:"'JetBrains Mono', monospace", fontSize: 9,
            letterSpacing:'0.22em', textTransform:'uppercase',
            padding:'3px 8px', borderRadius: 3, fontWeight: 700,
          }}>Right now</div>

          <div style={{
            fontFamily:"'Bricolage Grotesque', sans-serif",
            fontSize: 19, fontWeight: 600, letterSpacing:'-0.02em',
            color: C.ink, marginTop: 4, lineHeight: 1.2, marginBottom: 8,
          }}>You're on your way. Door code activates at 15:00.</div>

          <div style={{
            display:'grid', gridTemplateColumns:'1fr 1fr', gap: 10, marginTop: 4,
          }}>
            <div style={{
              padding:'10px 12px', background: C.bg,
              borderRadius: 8, border:`1px solid ${C.line}`,
            }}>
              <div style={{fontFamily:"'JetBrains Mono', monospace", fontSize: 8.5, letterSpacing:'0.18em', textTransform:'uppercase', color: C.soft, fontWeight: 600, marginBottom: 3}}>Door code</div>
              <div style={{fontFamily:"'JetBrains Mono', monospace", fontSize: 18, fontWeight: 700, letterSpacing:'0.05em'}}>4419</div>
            </div>
            <div style={{
              padding:'10px 12px', background: C.bg,
              borderRadius: 8, border:`1px solid ${C.line}`,
            }}>
              <div style={{fontFamily:"'JetBrains Mono', monospace", fontSize: 8.5, letterSpacing:'0.18em', textTransform:'uppercase', color: C.soft, fontWeight: 600, marginBottom: 3}}>Wi-Fi</div>
              <div style={{fontFamily:"'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700}}>Casa-Bea</div>
            </div>
          </div>
        </div>

        <Row
          time="15:00"
          state="now"
          label="Check-in opens"
          body="Self check-in. Keys in the brass box, left of the door."
          badge="2h 52m"
        />
        <Row
          time="17:30"
          state="future"
          label="Sunset on the rooftop"
          body="The roof terrace is yours — bring the bottle of Greco in the fridge."
        />
        <Row
          time="20:30"
          state="future"
          label="Dinner suggestion"
          body="Da Enzo al 29 — 4 min walk. Walk-ins only after 22:00."
        />
        <Row
          time="23:00"
          state="future"
          label="Quiet hours begin"
          body="Old building — neighbours sleep early."
        />

        <DayDivider day="DAY 3" date="Thu 28 May" />

        <Row
          time="07:00"
          state="future"
          label="Bakery opens"
          body="Maritozzo & cornetto from Innocenti, on the corner."
        />
        <Row
          time="11:00"
          state="future"
          label="Check-out"
          body="Leave keys in the brass box. Buon viaggio!"
        />
      </div>

      {/* Bottom nav — chapters */}
      <div style={{
        display:'flex', alignItems:'stretch',
        background: C.surface,
        borderTop:`1px solid ${C.line}`,
        padding:'4px 10px 10px',
      }}>
        {[
          { l:'Now',     active:true },
          { l:'Stay' },
          { l:'Around' },
          { l:'Talk' },
        ].map(b => (
          <div key={b.l} style={{
            flex:1, textAlign:'center', padding:'8px 4px',
          }}>
            <div style={{
              fontFamily:"'Bricolage Grotesque', sans-serif",
              fontSize: 12, fontWeight: b.active ? 700 : 500,
              color: b.active ? C.accent : C.soft,
              letterSpacing:'-0.005em',
            }}>{b.l}</div>
            {b.active && (
              <div style={{
                width: 18, height: 2, background: C.accent,
                margin:'4px auto 0', borderRadius: 2,
              }}/>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

window.AdagioMock = AdagioMock;
