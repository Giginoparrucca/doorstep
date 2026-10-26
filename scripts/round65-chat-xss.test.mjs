// Round 65 Phase 1 — Chat XSS regression guard.
//
// The audit at docs/SECURITY_ASSESSMENT_2026-10.md identified CRIT-1: the
// host chat renderer interpolated `${m.message}` directly into innerHTML
// for guest, host, bot, and system bubbles. A guest message like
// `<img src=x onerror="alert('xss')">` would run in the host session,
// enabling account takeover and PII exfiltration.
//
// This static test:
//   1. Confirms NO renderer still interpolates `${m.message}` raw.
//   2. Confirms the chatSafe/chatSafeBot helpers escape all six dangerous
//      characters (& < > " ' `) and that chatSafeBot's **bold** markdown
//      runs AFTER escaping (so a crafted message cannot inject HTML by
//      wrapping payload in **).
//   3. Confirms the helpers are defined inside the chat renderer scope.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(here, '..', 'host-console.html'), 'utf8');

// ── 1. No renderer may still interpolate ${m.message} raw ────────────────
assert.ok(!/>\$\{m\.message\}</.test(src),
  'no bubble may interpolate ${m.message} directly; must go through chatSafe/chatSafeBot');
// Also catch the specific markdown-first anti-pattern that was there before.
assert.ok(!/\$\{m\.message\.replace\(\/\\\*\\\*/.test(src),
  'markdown replace() must run AFTER escaping, not on the raw message');

// ── 2. The helpers exist with the right shape ────────────────────────────
assert.ok(/const chatSafe = \(s\) =>/.test(src), 'chatSafe helper must be defined');
assert.ok(/const chatSafeBot = \(s\) => chatSafe\(s\)\.replace\(\/\\\*\\\*\(\.\*\?\)\\\*\\\*\/g, '<strong>\$1<\/strong>'\)/.test(src),
  'chatSafeBot must escape first, then apply **bold** on the escaped text');

// ── 3. Each sender's bubble uses the correct helper ──────────────────────
assert.ok(/m\.sender === 'guest'[\s\S]{0,500}\$\{chatSafe\(m\.message\)\}/.test(src),
  'guest bubble must use chatSafe');
assert.ok(/m\.sender === 'host'[\s\S]{0,500}\$\{chatSafe\(m\.message\)\}/.test(src),
  'host bubble must use chatSafe');
assert.ok(/m\.sender === 'bot'[\s\S]{0,500}\$\{chatSafeBot\(m\.message\)\}/.test(src),
  'bot bubble must use chatSafeBot');
assert.ok(/m\.sender === 'system'[\s\S]{0,500}\$\{chatSafe\(m\.message\)\}/.test(src),
  'system bubble must use chatSafe');

// ── 4. Behaviour check — extract the helpers and run them in a sandbox ──
// Find the exact chatSafe + chatSafeBot block and eval it. Rewrite the
// `const` declarations as plain assignments so they land on the sandbox
// context, where this test can read them back.
const blockMatch = src.match(/const chatSafe = [\s\S]*?const chatSafeBot = [^;]+;/);
assert.ok(blockMatch, 'helpers block must be extractable for behavioural test');
const context = vm.createContext({});
const assignable = blockMatch[0].replace(/(^|\n)[ \t]*const /g, '$1');
vm.runInContext(assignable, context);
const chatSafe = context.chatSafe;
const chatSafeBot = context.chatSafeBot;
assert.equal(typeof chatSafe, 'function', 'chatSafe must be a function in the sandbox');
assert.equal(typeof chatSafeBot, 'function', 'chatSafeBot must be a function in the sandbox');

// Attack-shaped inputs — these would all fire JS if interpolated raw.
const attacks = [
  { in: '<img src=x onerror=alert(1)>', must: ['&lt;img', 'onerror=alert(1)&gt;'], mustnot: ['<img'] },
  { in: '<script>alert(1)</script>', must: ['&lt;script&gt;', '&lt;/script&gt;'], mustnot: ['<script>', '</script>'] },
  { in: '<svg onload=alert(1)>', must: ['&lt;svg', '&gt;'], mustnot: ['<svg'] },
  { in: '" onmouseover="alert(1)', must: ['&quot;', '&quot;'], mustnot: ['" '] },
  { in: "' onclick='alert(1)", must: ['&#39;'], mustnot: ["' "] },
  { in: '`${alert(1)}`', must: ['&#96;'], mustnot: ['`${'] },
  { in: '& < > " \' `', must: ['&amp;', '&lt;', '&gt;', '&quot;', '&#39;', '&#96;'], mustnot: ['<', '>'] },
];
for (const a of attacks) {
  const out = chatSafe(a.in);
  for (const needle of a.must) assert.ok(out.includes(needle), `chatSafe(${JSON.stringify(a.in)}) must include ${JSON.stringify(needle)}; got ${JSON.stringify(out)}`);
  for (const bad of a.mustnot) assert.ok(!out.includes(bad), `chatSafe(${JSON.stringify(a.in)}) must NOT include ${JSON.stringify(bad)}; got ${JSON.stringify(out)}`);
}

// Null / undefined safety — must not throw and must not emit "null" / "undefined".
assert.equal(chatSafe(null), '');
assert.equal(chatSafe(undefined), '');
assert.equal(chatSafe(''), '');
assert.equal(chatSafe(0), '0');
assert.equal(chatSafe(123), '123');

// chatSafeBot — bold markdown works on ESCAPED text; cannot inject HTML.
assert.equal(chatSafeBot('plain text'), 'plain text');
assert.equal(chatSafeBot('a **bold** b'), 'a <strong>bold</strong> b');
assert.equal(chatSafeBot('a **b& c< d>** e'), 'a <strong>b&amp; c&lt; d&gt;</strong> e');

// Adversarial: can an attacker wrap `**` around an HTML payload to inject
// a <strong><img …></strong>? No — the inner HTML gets escaped first.
const bolded = chatSafeBot('**<img src=x onerror=alert(1)>**');
assert.ok(bolded.includes('<strong>'), 'bold wrapper survives');
assert.ok(bolded.includes('&lt;img'), 'injected img is still escaped inside the bold');
assert.ok(!bolded.includes('<img'), 'no raw <img> can appear inside the bold');

// Adversarial: attribute-break attempt. The `**` wrapper becomes <strong>…</strong>
// around text; onerror= inside <strong> is just text content, not an attribute,
// because < > " ' are all escaped. The real guarantee is that no NEW raw tag
// can appear in the output beyond our own <strong>/<\/strong>.
const attrBreak = chatSafeBot('** onerror=alert(1) **');
assert.ok(attrBreak.includes('<strong>') && attrBreak.includes('</strong>'), 'bold wraps text');
// Only our <strong> tags are allowed; no attacker-controlled <tagname …> can appear.
const injectedTags = (attrBreak.match(/<(?!\/?strong>)[^>]+>/g) || []);
assert.deepEqual(injectedTags, [],
  `no attacker-controlled HTML tag may appear in bolded output; found ${JSON.stringify(injectedTags)}`);

console.log('PASS round65-chat-xss: no renderer interpolates ${m.message} raw; chatSafe escapes & < > " \' `; chatSafeBot escapes first then applies **bold** markdown; null/undefined safe; adversarial inputs (html injection, attribute break, markdown-wrapped HTML) all neutralised');
