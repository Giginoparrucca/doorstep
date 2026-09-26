// STANZA — the app as a chat thread with the host.
// No dashboard. Every piece of info arrives as a message.
// Bottom = always-on input. Top = contact header. That's it.

function StanzaMock() {
  const C = {
    bg:'#F2EFE9',
    surface:'#FFFFFF',
    bubbleHost:'#FFFFFF',
    bubbleUser:'#D9C4A0',
    bubbleSystem:'rgba(74,107,74,0.08)',
    ink:'#1A1A14',
    soft:'#6E6E5F',
    accent:'#4A6B4A',
    accentInk:'#FFFFFF',
    line:'rgba(26,26,20,0.10)',
    hostInk:'#1A1A14',
  };

  const Bubble = ({ from = 'host', children, attach, time }) => {
    const isHost = from === 'host';
    const isSys = from === 'system';
    return (
      <div style={{
        display:'flex', flexDirection:'column',
        alignItems: isHost ? 'flex-start' : (isSys ? 'center' : 'flex-end'),
        maxWidth:'100%',
      }}>
        <div style={{
          maxWidth:'80%',
          background: isHost ? C.bubbleHost : (isSys ? C.bubbleSystem : C.bubbleUser),
          color: C.ink,
          padding: isSys ? '6px 12px' : '9px 13px',
          borderRadius: isSys ? 999 : 14,
          borderBottomLeftRadius: isHost ? 4 : 14,
          borderBottomRightRadius: from === 'user' ? 4 : 14,
          fontSize: isSys ? 11 : 13,
          lineHeight: 1.5,
          border: isHost ? `1px solid ${C.line}` : 'none',
          boxShadow: isHost ? '0 1px 2px rgba(0,0,0,0.03)' : 'none',
          fontFamily:"'Geist', sans-serif", fontWeight: isSys ? 500 : 400,
          color: isSys ? C.soft : C.ink,
        }}>
          {children}
        </div>
        {attach && (
          <div style={{
            marginTop: 4,
            background: C.bubbleHost,
            border:`1px solid ${C.line}`,
            borderRadius: 12, borderBottomLeftRadius: 4,
            padding:'10px 12px',
            maxWidth: '85%',
            display:'flex', alignItems:'center', gap: 12,
          }}>
            {attach}
          </div>
        )}
        {time && (
          <div style={{
            fontFamily:"'JetBrains Mono', monospace",
            fontSize: 9, color: C.soft, marginTop: 3,
            padding: from === 'user' ? '0 6px 0 0' : '0 0 0 6px',
            letterSpacing:'0.04em',
          }}>{time}</div>
        )}
      </div>
    );
  };

  return (
    <div style={{
      width:'100%', height:'100%',
      background: C.bg,
      color: C.ink,
      fontFamily:"'Geist', system-ui, sans-serif",
      display:'flex', flexDirection:'column',
      overflow:'hidden', boxSizing:'border-box',
    }}>
      {/* Header */}
      <div style={{
        background: C.surface,
        borderBottom:`1px solid ${C.line}`,
        padding:'10px 14px 12px',
        display:'flex', alignItems:'center', gap: 10,
      }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.ink}
          strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5 M12 19l-7-7 7-7"/>
        </svg>
        <div style={{
          width: 38, height: 38, borderRadius:'50%',
          background:`linear-gradient(135deg, ${C.accent}, #6B8B5A)`,
          color: '#fff', display:'flex', alignItems:'center', justifyContent:'center',
          fontFamily:"'Bricolage Grotesque', sans-serif", fontSize: 16, fontWeight: 600,
          position:'relative',
        }}>
          B
          <div style={{
            position:'absolute', bottom: 0, right: 0,
            width: 10, height: 10, borderRadius:'50%',
            background:'#5BC07B', border:`2px solid ${C.surface}`,
          }}/>
        </div>
        <div style={{flex:1, minWidth: 0}}>
          <div style={{
            fontFamily:"'Bricolage Grotesque', sans-serif",
            fontSize: 15, fontWeight: 600, color: C.ink, letterSpacing:'-0.01em', lineHeight: 1.1,
          }}>Beatrice &amp; Marco</div>
          <div style={{
            fontFamily:"'Geist', sans-serif", fontSize: 11,
            color: C.accent, fontWeight: 500, marginTop: 1,
          }}>● Casa di Beatrice · usually replies in 4 min</div>
        </div>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.ink}
          strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="5"  cy="12" r="1.5"/>
          <circle cx="12" cy="12" r="1.5"/>
          <circle cx="19" cy="12" r="1.5"/>
        </svg>
      </div>

      {/* Pinned strip */}
      <div style={{
        background:'rgba(74,107,74,0.06)',
        borderBottom:`1px solid ${C.line}`,
        padding:'8px 14px',
        display:'flex', alignItems:'center', gap: 10,
      }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.accent}
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 17v5 M9 10.76V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v4.76l2 4.24H7l2-4.24z"/>
        </svg>
        <div style={{flex:1, fontSize: 11.5, color: C.ink, fontWeight: 500}}>
          Pinned · Door <span style={{fontFamily:"'JetBrains Mono', monospace", background:'#fff', padding:'1px 5px', borderRadius:3, fontWeight: 600, border:`1px solid ${C.line}`}}>4419</span> · Wi-Fi <span style={{fontFamily:"'JetBrains Mono', monospace", fontWeight: 500}}>Casa-Bea</span>
        </div>
        <div style={{
          fontFamily:"'JetBrains Mono', monospace",
          fontSize: 9, letterSpacing:'0.14em', color: C.accent, fontWeight: 600,
        }}>SEE ALL</div>
      </div>

      {/* Conversation */}
      <div style={{
        flex:1, overflow:'hidden',
        padding:'14px 14px',
        display:'flex', flexDirection:'column', gap: 10,
        background: C.bg,
      }}>
        <Bubble from="system">Today · 14:08</Bubble>

        <Bubble from="host" time="14:08">
          Ciao Sara — benvenuta! 🌞 Your room is ready. Here's everything you need.
        </Bubble>

        <Bubble from="host">
          <div style={{
            display:'flex', alignItems:'center', gap: 12,
          }}>
            <div style={{
              width: 38, height: 38, borderRadius: 10, background: C.bubbleSystem,
              display:'flex', alignItems:'center', justifyContent:'center',
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.accent}
                strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12a10 10 0 0 1 14 0 M8.5 15.5a5 5 0 0 1 7 0 M12 19h.01"/>
              </svg>
            </div>
            <div>
              <div style={{
                fontFamily:"'JetBrains Mono', monospace", fontSize: 8.5,
                letterSpacing:'0.18em', textTransform:'uppercase', color: C.soft, fontWeight: 600,
              }}>Wi-Fi</div>
              <div style={{fontFamily:"'JetBrains Mono', monospace", fontSize: 14, fontWeight: 600}}>Casa-Bea</div>
              <div style={{fontFamily:"'JetBrains Mono', monospace", fontSize: 11, color: C.soft}}>pwd · ciao2026</div>
            </div>
          </div>
        </Bubble>

        <Bubble from="host" time="14:09">
          Keys in the brass box, left of the door. Code{' '}
          <span style={{
            fontFamily:"'JetBrains Mono', monospace",
            fontWeight: 700,
            background: C.accent, color: C.accentInk,
            padding:'1px 6px', borderRadius: 3,
            letterSpacing:'0.04em',
          }}>4419</span>. The latch sticks — push hard.
        </Bubble>

        <Bubble from="user" time="14:11">
          Grazie!! Should we get something for dinner before arriving?
        </Bubble>

        <Bubble from="host" time="14:12">
          Don't bother — there's a bottle of Greco di Tufo in the fridge and the trattoria downstairs takes walk-ins until 23:00. I'll send a map.
        </Bubble>

        {/* Typing indicator */}
        <div style={{display:'flex', alignItems:'center', gap: 8, marginLeft: 2}}>
          <div style={{
            background: C.bubbleHost,
            border:`1px solid ${C.line}`,
            borderRadius: 14, borderBottomLeftRadius: 4,
            padding:'9px 13px',
            display:'flex', gap: 4,
          }}>
            <span style={{width:5, height:5, borderRadius:'50%', background: C.soft, opacity: 0.5}}/>
            <span style={{width:5, height:5, borderRadius:'50%', background: C.soft, opacity: 0.75}}/>
            <span style={{width:5, height:5, borderRadius:'50%', background: C.soft}}/>
          </div>
          <div style={{fontFamily:"'JetBrains Mono', monospace", fontSize:9, color: C.soft, letterSpacing:'0.06em'}}>typing</div>
        </div>
      </div>

      {/* Suggestion chips */}
      <div style={{
        display:'flex', gap: 6, padding:'8px 12px 6px',
        background: C.bg, overflow:'hidden',
      }}>
        {['Check in now', 'House rules', 'Best aperitivo?', 'Call host'].map(s => (
          <div key={s} style={{
            padding:'6px 12px',
            background: C.surface, border:`1px solid ${C.line}`,
            borderRadius: 999,
            fontFamily:"'Geist', sans-serif", fontSize: 11.5, fontWeight: 500,
            color: C.ink, whiteSpace:'nowrap',
          }}>{s}</div>
        ))}
      </div>

      {/* Composer */}
      <div style={{
        display:'flex', alignItems:'center', gap: 8,
        padding:'8px 12px 12px',
        background: C.surface,
        borderTop:`1px solid ${C.line}`,
      }}>
        <div style={{
          width: 34, height: 34, borderRadius:'50%',
          background: C.bg, border:`1px solid ${C.line}`,
          display:'flex', alignItems:'center', justifyContent:'center',
          color: C.ink,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14 M5 12h14"/>
          </svg>
        </div>
        <div style={{
          flex:1, padding:'8px 14px', borderRadius: 999,
          background: C.bg, border:`1px solid ${C.line}`,
          fontSize: 12.5, color: C.soft, fontWeight: 400,
          display:'flex', alignItems:'center',
        }}>
          Message Beatrice…
        </div>
        <div style={{
          width: 34, height: 34, borderRadius:'50%',
          background: C.accent, color: C.accentInk,
          display:'flex', alignItems:'center', justifyContent:'center',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="2" width="6" height="12" rx="3"/>
            <path d="M5 10v2a7 7 0 0 0 14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="22"/>
          </svg>
        </div>
      </div>
    </div>
  );
}

window.StanzaMock = StanzaMock;
