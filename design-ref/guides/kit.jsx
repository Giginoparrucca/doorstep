// Illustration kit — reusable SVG primitives for "Come funziona" step frames.
// Frame = 320×200 viewBox (16:10). Palette per frame: neutral tints + blue + (optional) one status colour.
// All words are <text> nodes fed from label props so they can be translated.

const K = {
  bg:'#F8FBFF', t1:'#EAF3FF', t2:'#D7E7FF', white:'#FFFFFF',
  blue:'#005BFF', ink:'#061A3D', soft:'#6B7A90',
  green:'#2E9E6B', greenBg:'#E4F5EC', line:'rgba(0,91,255,0.14)',
  font:"'DM Sans', system-ui, sans-serif",
};

function IFrame({ children, title }) {
  return (
    <svg viewBox="0 0 320 200" role="img" aria-label={title} style={{ display:'block', width:'100%', height:'auto' }}>
      <rect x="0" y="0" width="320" height="200" rx="10" fill={K.bg}/>
      {children}
    </svg>
  );
}

const Bar = ({ x, y, w, h = 6, c = K.t2 }) => <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={c}/>;

function Card({ x, y, w, h, stroke = K.line, sw = 1, fill = K.white }) {
  return <rect x={x} y={y} width={w} height={h} rx="8" fill={fill} stroke={stroke} strokeWidth={sw}/>;
}

// Simplified console page: header strip + title placeholder.
function Page({ children }) {
  return (
    <g>
      <rect x="0" y="0" width="320" height="30" rx="10" fill={K.white}/>
      <rect x="0" y="20" width="320" height="10" fill={K.white}/>
      <line x1="0" y1="30" x2="320" y2="30" stroke={K.line}/>
      <Bar x={16} y={12} w={70} h={7} c={K.t2}/>
      {children}
    </g>
  );
}

function Row({ x, y, w, hi = false, faded = false, status, statusLabel }) {
  const o = faded ? 0.55 : 1;
  const col = status === 'green' ? K.green : K.blue;
  const bg = status === 'green' ? K.greenBg : K.blue;
  return (
    <g opacity={o}>
      {hi && <rect x={x - 4} y={y - 4} width={w + 8} height={30} rx="7" fill={K.white} stroke={col} strokeWidth="2"/>}
      {status === 'green' && <rect x={x - 4} y={y - 4} width={4} height={30} rx="2" fill={K.green}/>}
      <circle cx={x + 10} cy={y + 11} r="8" fill={K.t1}/>
      <Bar x={x + 26} y={y + 5} w={w * 0.34}/>
      <Bar x={x + 26} y={y + 14} w={w * 0.2} h={5} c={K.t1}/>
      {statusLabel && (
        <g>
          <rect x={x + w - 64} y={y + 3} width="60" height="16" rx="8" fill={bg}/>
          <text x={x + w - 34} y={y + 14.5} textAnchor="middle" fontFamily={K.font} fontSize="9.5" fontWeight="700"
            fill={status === 'green' ? K.green : K.white}>{statusLabel}</text>
        </g>
      )}
    </g>
  );
}

function Btn({ x, y, w, h = 22, label, active = true }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="6" fill={active ? K.blue : K.t1}/>
      {label
        ? <text x={x + w / 2} y={y + h / 2 + 3.8} textAnchor="middle" fontFamily={K.font} fontSize="10.5" fontWeight="700"
            fill={active ? K.white : K.soft}>{label}</text>
        : <Bar x={x + 10} y={y + h / 2 - 3} w={w - 20} c={K.t2}/>}
    </g>
  );
}

function Marker({ x, y, n }) {
  return (
    <g>
      <circle cx={x} cy={y} r="12" fill={K.blue} stroke={K.white} strokeWidth="3"/>
      <text x={x} y={y + 4.2} textAnchor="middle" fontFamily={K.font} fontSize="12" fontWeight="700" fill={K.white}>{n}</text>
    </g>
  );
}

// Pointer cursor with tap ripple. (x,y) = tip.
function Cursor({ x, y, ripple = true }) {
  return (
    <g>
      {ripple && <circle cx={x} cy={y} r="11" fill="none" stroke={K.blue} strokeWidth="1.5" opacity="0.45"/>}
      {ripple && <circle cx={x} cy={y} r="18" fill="none" stroke={K.blue} strokeWidth="1" opacity="0.2"/>}
      <path d={`M${x} ${y} l0 17 l4.5 -4 l3.2 7 l3.2 -1.5 l-3.2 -6.8 l6 -0.4 z`} fill={K.ink} stroke={K.white} strokeWidth="1.4" strokeLinejoin="round"/>
    </g>
  );
}

function Arrow({ d, end }) {
  const [ex, ey, ang] = end;
  return (
    <g>
      <path d={d} fill="none" stroke={K.blue} strokeWidth="1.8" strokeDasharray="4 4" strokeLinecap="round"/>
      <path d="M0 0 L-7 -4 L-7 4 Z" fill={K.blue} transform={`translate(${ex} ${ey}) rotate(${ang})`}/>
    </g>
  );
}

function FileIcon({ x, y, label, c = K.blue }) {
  return (
    <g>
      <path d={`M${x} ${y} h22 l10 10 v30 a3 3 0 0 1 -3 3 h-26 a3 3 0 0 1 -3 -3 v-37 a3 3 0 0 1 3 -3 z`} fill={K.white} stroke={c} strokeWidth="1.8"/>
      <path d={`M${x + 22} ${y} v10 h10`} fill="none" stroke={c} strokeWidth="1.8"/>
      <text x={x + 16} y={y + 31} textAnchor="middle" fontFamily={K.font} fontSize="9" fontWeight="700" fill={c}>{label}</text>
    </g>
  );
}

function QR({ x, y, s, c = K.ink }) {
  const n = 7, cell = s / n, cells = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const corner = (i < 2 && j < 2) || (i < 2 && j > 4) || (i > 4 && j < 2);
    if (corner || ((i * 3 + j * 5) % 4 === 0)) cells.push(<rect key={i + '-' + j} x={x + j * cell} y={y + i * cell} width={cell - 0.6} height={cell - 0.6} fill={c}/>);
  }
  return <g>{cells}</g>;
}

function Phone({ x, y, w, h, children }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="14" fill={K.white} stroke={K.t2} strokeWidth="3"/>
      <rect x={x + w / 2 - 14} y={y + 6} width="28" height="4" rx="2" fill={K.t2}/>
      {children}
    </g>
  );
}

Object.assign(window, { K, IFrame, Bar, Card, Page, Row, Btn, Marker, Cursor, Arrow, FileIcon, QR, Phone });
