// api/_alloggiati-crypto.js — Round 44 Phase 0.5
//
// AES-256-GCM helpers for Alloggiati credential storage. Kept as a
// `_prefixed` utility (no default export) so Vercel does NOT count it
// against the Hobby-plan 12-function cap.
//
// Interface
// ---------
//   encryptCredentials({ utente, password, wskey }) → { enc, nonce, keyId }
//   decryptCredentials({ enc, nonce, keyId }) → { utente, password, wskey }
//
// The stored payload is a single ciphertext of the JSON string
// `{"utente":"...","password":"...","wskey":"..."}`. Storing three fields
// together with one nonce beats three-nonce-schemes because
//   (a) all three are always read together anyway and
//   (b) an attacker with DB read cannot tell WHICH field caused a
//       decrypt failure and cannot swap fields between rows.
//
// Key material
// ------------
// `ALLOGGIATI_ENC_KEY` env var. Base64-encoded 32 bytes (256-bit).
// Generate once with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// Store the SAME value on every environment we want to decrypt in.
// LOSING THIS KEY MEANS LOSING EVERY STORED CREDENTIAL — there is no
// recovery path. Back it up in a password manager the moment you
// generate it.
//
// Key versioning (`keyId`)
// ------------------------
// Rows carry `enc_key_id` (default `"v1"`). Rotating to a new key
// later means setting `ALLOGGIATI_ENC_KEY_V2`, teaching decrypt() to
// try v2 first then v1, and re-encrypting rows in the background.
// That path is code-only (no schema change) but out of scope for
// Phase 0.5.

import { webcrypto } from 'node:crypto';
// NB: `subtle` can be destructured safely (its methods live on the
// subtle object itself), but `getRandomValues` is a method on the
// Crypto instance — destructuring detaches it and Node throws
// "Value of 'this' must be of type Crypto" at call time. Keep it on
// the webcrypto object.
const subtle = webcrypto.subtle;
const getRandomValues = (arr) => webcrypto.getRandomValues(arr);

const KEY_ID_DEFAULT = 'v1';
const NONCE_BYTES    = 12;   // 96-bit GCM nonce (spec-recommended)

function requireKey(keyId) {
  // Only v1 exists today. Structured to make v2 trivial to add later
  // (return the correct raw bytes for the requested version).
  if (keyId !== KEY_ID_DEFAULT) {
    throw new Error(`Unknown Alloggiati enc key: ${keyId}`);
  }
  const b64 = process.env.ALLOGGIATI_ENC_KEY || '';
  if (!b64) throw new Error('ALLOGGIATI_ENC_KEY not configured');
  const raw = Buffer.from(b64, 'base64');
  if (raw.length !== 32) throw new Error(`ALLOGGIATI_ENC_KEY must decode to 32 bytes, got ${raw.length}`);
  return raw;
}

async function importAesKey(rawBytes) {
  return subtle.importKey(
    'raw',
    rawBytes,
    { name: 'AES-GCM' },
    /*extractable*/ false,
    ['encrypt', 'decrypt'],
  );
}

function b64(u8)  { return Buffer.from(u8).toString('base64'); }
function unb64(s) { return new Uint8Array(Buffer.from(String(s || ''), 'base64')); }

// Encrypt a credentials triple. Returns { enc, nonce, keyId } — each
// value is a base64 string ready to store in the row.
export async function encryptCredentials(triple) {
  if (!triple || typeof triple !== 'object') throw new Error('encryptCredentials: bad input');
  const { utente, password, wskey } = triple;
  if (typeof utente   !== 'string' || !utente.trim())   throw new Error('utente required');
  if (typeof password !== 'string' || !password)         throw new Error('password required');
  if (typeof wskey    !== 'string' || !wskey.trim())     throw new Error('wskey required');

  const keyId = KEY_ID_DEFAULT;
  const rawKey = requireKey(keyId);
  const cryptoKey = await importAesKey(rawKey);

  const plaintext = new TextEncoder().encode(JSON.stringify({
    utente: utente.trim(),
    password,                  // password can contain whitespace — do not trim
    wskey: wskey.trim(),
  }));
  const nonce = getRandomValues(new Uint8Array(NONCE_BYTES));
  const ciphertext = new Uint8Array(await subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    cryptoKey,
    plaintext,
  ));

  return { enc: b64(ciphertext), nonce: b64(nonce), keyId };
}

// Decrypt what encryptCredentials produced. Throws on tampering, wrong
// key, missing key. Caller decides how to surface that to the client
// (usually a generic "credentials unreadable — re-enter" message).
export async function decryptCredentials(row) {
  if (!row || typeof row !== 'object') throw new Error('decryptCredentials: bad input');
  const keyId = row.keyId || row.enc_key_id || KEY_ID_DEFAULT;
  const rawKey = requireKey(keyId);
  const cryptoKey = await importAesKey(rawKey);

  const nonce = unb64(row.nonce || row.credentials_nonce);
  const ciphertext = unb64(row.enc || row.credentials_enc);
  if (nonce.length !== NONCE_BYTES) throw new Error('bad nonce length');

  const plaintext = new Uint8Array(await subtle.decrypt(
    { name: 'AES-GCM', iv: nonce },
    cryptoKey,
    ciphertext,
  ));
  const parsed = JSON.parse(new TextDecoder().decode(plaintext));
  if (!parsed || typeof parsed !== 'object' ||
      typeof parsed.utente !== 'string' ||
      typeof parsed.password !== 'string' ||
      typeof parsed.wskey !== 'string') {
    throw new Error('decrypted payload malformed');
  }
  return parsed;
}
