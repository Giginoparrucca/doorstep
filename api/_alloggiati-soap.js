// api/_alloggiati-soap.js — Round 44 Phase 1
//
// Thin SOAP client for the two auth operations on Alloggiati Web:
//   • GenerateToken(Utente, Password, WsKey) → { token, issued, expires }
//   • Authentication_Test(Utente, token)     → true / error
//
// Kept as a `_prefixed` utility (no default export) so Vercel does NOT
// count it against the Hobby-plan 12-function cap.
//
// Design notes
// ------------
// - No SOAP library. The two envelopes we need are ~10 lines of XML
//   each; a regex extractor pulls the fields we care about. Bringing
//   in `soap` or `strong-soap` would add >100 dependencies for one
//   function that lives entirely inside our own server.
// - Credentials are only ever handled server-side. `generateToken()`
//   receives them from `decryptCredentials()` and never logs them.
// - Every call is capped by an AbortController timeout. The portal is
//   sometimes slow; keeping the ceiling short means the client sees a
//   fast "portal timeout" message instead of Vercel's generic 504.
// - Alloggiati returns esito=true/false + a numeric ErroreCod. We map
//   the most common codes to human copy (localised by the caller).
//   Any unmapped code falls back to `ErroreDes` verbatim.

const SOAP_URL = 'https://alloggiatiweb.poliziadistato.it/Service/Service.asmx';
const SOAP_NS  = 'AlloggiatiService';
const DEFAULT_TIMEOUT_MS = 8000;

// XML-escape values going INTO the envelope. Alloggiati usernames are
// alnum but passwords and wskeys frequently contain '+', '=', '/'
// which are XML-safe; the '<', '>', '&', quotes handling is defensive.
function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Pulls the first <tag>...</tag> value out of a SOAP response body.
// Namespace-agnostic (matches optional xmlns prefixes). Returns '' if
// the tag isn't found — callers decide whether that's a hard failure.
function pickTag(xml, tag) {
  if (!xml) return '';
  const re = new RegExp(
    `<(?:[a-zA-Z0-9]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9]+:)?${tag}>`,
    'i',
  );
  const m = re.exec(xml);
  if (!m) return '';
  // Preserve empty tags as ''. Trim whitespace/newlines PostgREST-style
  // callers can then treat '' as null.
  return (m[1] || '').trim();
}

async function postSoap({ soapAction, body, timeoutMs }) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(SOAP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction':   `"${soapAction}"`,
      },
      body,
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(t);
    if (e.name === 'AbortError') {
      const err = new Error('Alloggiati portal timeout');
      err.code = 'timeout';
      throw err;
    }
    const err = new Error(`Network error contacting Alloggiati: ${e.message}`);
    err.code = 'network';
    throw err;
  }
  clearTimeout(t);
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    // SOAP faults come back as 500 with a <soap:Fault> body. Pick the
    // <faultstring> if there is one, otherwise report the status.
    const fault = pickTag(text, 'faultstring');
    const err = new Error(fault || `Alloggiati portal HTTP ${res.status}`);
    err.code = 'http';
    err.status = res.status;
    throw err;
  }
  return text;
}

// A small set of well-known ErroreCod values → stable machine codes.
// The verify endpoint uses these to pick a good UI message. Anything
// not in the map surfaces the portal's ErroreDes verbatim.
const KNOWN_CODES = {
  0:   'ok',
  100: 'bad_credentials',   // "Utente o password errati"
  101: 'wskey_expired',     // "WsKey scaduta"
  102: 'wskey_bad',         // "WsKey non valida"
  103: 'user_disabled',
  104: 'wskey_missing',
};

function interpretResult(xml, resultTag) {
  const result = pickTag(xml, resultTag);
  // Handle both flat and nested — some SOAP responses inline the
  // <ResultTag> around the fields directly; pickTag returns the inner
  // body either way, so read fields off the whole document if
  // resultTag came back empty.
  const scope = result || xml;
  const esito     = pickTag(scope, 'esito').toLowerCase();
  const erroreCod = parseInt(pickTag(scope, 'ErroreCod') || '0', 10) || 0;
  const erroreDes = pickTag(scope, 'ErroreDes');
  const erroreDet = pickTag(scope, 'ErroreDettaglio');
  const ok = esito === 'true' && erroreCod === 0;
  return {
    ok,
    code: KNOWN_CODES[erroreCod] || (ok ? 'ok' : 'portal_error'),
    erroreCod,
    erroreDes,
    erroreDet,
    scope,
  };
}

// Public — GenerateToken.
// Returns { token, issued, expires } on success.
// Throws an Error with .code (bad_credentials | wskey_expired |
// wskey_bad | portal_error | timeout | network | http) on failure.
export async function generateToken({ utente, password, wskey }, opts = {}) {
  if (!utente || !password || !wskey) {
    throw new Error('generateToken: missing utente/password/wskey');
  }
  const body =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
      `<soap:Body>` +
        `<GenerateToken xmlns="${SOAP_NS}">` +
          `<Utente>${xmlEscape(utente)}</Utente>` +
          `<Password>${xmlEscape(password)}</Password>` +
          `<WsKey>${xmlEscape(wskey)}</WsKey>` +
        `</GenerateToken>` +
      `</soap:Body>` +
    `</soap:Envelope>`;
  const xml = await postSoap({
    soapAction: `${SOAP_NS}/GenerateToken`,
    body,
    timeoutMs: opts.timeoutMs,
  });
  const r = interpretResult(xml, 'GenerateTokenResult');
  if (!r.ok) {
    const err = new Error(r.erroreDes || 'Alloggiati portal rejected the credentials');
    err.code = r.code;
    err.erroreCod = r.erroreCod;
    err.erroreDet = r.erroreDet;
    throw err;
  }
  const token   = pickTag(r.scope, 'token');
  const issued  = pickTag(r.scope, 'issued');
  const expires = pickTag(r.scope, 'expires');
  if (!token) {
    const err = new Error('Alloggiati portal returned an empty token');
    err.code = 'portal_error';
    throw err;
  }
  return { token, issued, expires };
}

// Public — Authentication_Test.
// Returns true on success. Throws on failure (same .code taxonomy as
// generateToken).
export async function authenticationTest({ utente, token }, opts = {}) {
  if (!utente || !token) {
    throw new Error('authenticationTest: missing utente/token');
  }
  const body =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
      `<soap:Body>` +
        `<Authentication_Test xmlns="${SOAP_NS}">` +
          `<Utente>${xmlEscape(utente)}</Utente>` +
          `<token>${xmlEscape(token)}</token>` +
        `</Authentication_Test>` +
      `</soap:Body>` +
    `</soap:Envelope>`;
  const xml = await postSoap({
    soapAction: `${SOAP_NS}/Authentication_Test`,
    body,
    timeoutMs: opts.timeoutMs,
  });
  const r = interpretResult(xml, 'Authentication_TestResult');
  if (!r.ok) {
    const err = new Error(r.erroreDes || 'Alloggiati authentication test failed');
    err.code = r.code;
    err.erroreCod = r.erroreCod;
    err.erroreDet = r.erroreDet;
    throw err;
  }
  return true;
}

// Exported for the unit-style local self-check.
export const _internal = { xmlEscape, pickTag, interpretResult };
