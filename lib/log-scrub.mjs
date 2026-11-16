// Round 67 Phase 6 — log scrubbing. Vercel keeps function logs; nothing that
// identifies a guest or opens an account may reach them.
//
// scrub(value) returns a copy safe to log:
//   e-mail            → first 2 characters of the local part + «***@domain»
//   phone number      → «***» + last 3 digits (international prefix, or an
//                       Italian mobile written 3xx…)
//   JWT / guest token → «[token]»  (eyJ….….…, or base64url.base64url ≥ 20+20)
//   API keys          → «[secret]» (sb_secret_…, sk_…, re_…, Bearer …)
//   by field name     → document/ID numbers, fiscal codes, passwords, tokens,
//                       keys, wskey, codes, names and birth data: «[redacted]»
//   raw bodies        → fields called body/raw/payload keep only known-safe
//                       keys (action, status, ids, booking code, counts).
// Errors keep their name and a scrubbed message/stack.
//
// installConsoleScrub() wraps console.log/info/warn/error/debug once per
// process so every existing log call in api/ goes through scrub() (each
// function entry file imports this module first).
const EMAIL = /([A-Za-z0-9._%+-]{1,64})@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g;
const GUEST_TOKEN = /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g;
const SECRET = /\b(?:sb_secret_|sb_publishable_|sk_(?:live|test)_|re_|whsec_|xox[bp]-)[A-Za-z0-9_-]{8,}/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const INTL_PHONE = /(?<![\w.:/-])(?:\+|00)\d[\d\s().-]{6,17}\d(?![\w-])/g;
const IT_MOBILE = /(?<![\w.:/-])3\d{2}[\s.-]?\d{3}[\s.-]?\d{3,4}(?![\w.:-])/g;

const SENSITIVE_KEY = /^(?:document_?number|doc_?number|numero_?documento|passport(?:_?number)?|id_?number|fiscal_?code|codice_?fiscale|tax_?code|password|passwd|pwd|secret|.*_secret|token|.*_token|access_?token|refresh_?token|api_?key|apikey|authorization|cookie|set-cookie|wskey|utente|keybox_?code|door_?code|access_?code|otp|code_?hash|iban|surname|name|first_?name|last_?name|guest_?name|full_?name|date_?of_?birth|dob|place_?of_?birth|residence_?address|invoice_?email)$/i;
const EMAIL_KEY = /(?:^|_)e?mail$|email/i;
const PHONE_KEY = /phone|telefono|mobile|cell/i;
const BODY_KEY = /^(?:body|raw|payload|request_?body|req_?body)$/i;
const SAFE_BODY_KEYS = new Set(['action', 'status', 'property_id', 'booking_code', 'checkin_id', 'room_id', 'id', 'ids', 'kind', 'mode', 'type', 'dry_run', 'dry', 'count', 'limit', 'lang', 'source', 'outcome', 'error', 'code']);

export function maskEmail(s) { return String(s).replace(EMAIL, (_, local, domain) => `${local.slice(0, 2)}***@${domain}`); }
export function maskPhone(s) {
  const d = String(s).replace(/\D/g, '');
  return d.length >= 3 ? '***' + d.slice(-3) : '***';
}
export function scrubString(input) {
  let s = String(input);
  s = s.replace(JWT, '[token]').replace(BEARER, 'Bearer [token]').replace(SECRET, '[secret]').replace(GUEST_TOKEN, '[token]');
  s = maskEmail(s);
  s = s.replace(INTL_PHONE, m => maskPhone(m)).replace(IT_MOBILE, m => maskPhone(m));
  return s;
}

export function scrub(value, key = '', depth = 0, seen = new WeakSet()) {
  if (value == null) return value;
  if (key && SENSITIVE_KEY.test(key)) return '[redacted]';
  if (typeof value === 'string') {
    if (key && EMAIL_KEY.test(key)) return value.includes('@') ? maskEmail(value) : '[redacted]';
    if (key && PHONE_KEY.test(key)) return maskPhone(value);
    return scrubString(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    if (key && PHONE_KEY.test(key)) return maskPhone(value);
    return value;
  }
  if (typeof value === 'function' || typeof value === 'symbol') return `[${typeof value}]`;
  if (depth > 6) return '[…]';
  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    if (value instanceof Error) {
      const e = new Error(scrubString(value.message));
      e.name = value.name;
      if (value.stack) e.stack = scrubString(value.stack);
      if (value.code != null) e.code = scrub(value.code, 'code', depth + 1, seen);
      return e;
    }
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return `[${value.length} bytes]`;
    if (Array.isArray(value)) return value.slice(0, 200).map(v => scrub(v, '', depth + 1, seen));
    const out = {};
    const keepOnly = key && BODY_KEY.test(key);
    for (const [k, v] of Object.entries(value)) {
      if (keepOnly && !SAFE_BODY_KEYS.has(k)) { out[k] = '[omitted]'; continue; }
      out[k] = scrub(v, k, depth + 1, seen);
    }
    return out;
  }
  return value;
}

const INSTALLED = Symbol.for('welcomebnb.logScrubInstalled');
export function installConsoleScrub(target = globalThis.console) {
  if (!target || target[INSTALLED]) return false;
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = target[level];
    if (typeof original !== 'function') continue;
    target[level] = function scrubbedLog(...args) {
      let safe;
      try { safe = args.map(a => scrub(a)); } catch (_) { safe = ['[log scrub failed]']; }
      return original.apply(this, safe);
    };
  }
  Object.defineProperty(target, INSTALLED, { value: true });
  return true;
}

installConsoleScrub();
