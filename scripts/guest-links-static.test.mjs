import assert from 'node:assert/strict';
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(html, /function guestLinkedText\(value\)/);
assert.match(html, /target="_blank" rel="noopener noreferrer"/);
assert.match(html, /parsed\.protocol === 'https:' \|\| parsed\.protocol === 'http:'\)/);
for (const text of [
  'guestLinkedText(r.desc)',
  'guestLinkedText(transportInfo)',
  'guestLinkedText(ciInst)',
  'guestLinkedText(coInst)',
]) assert.ok(html.includes(text), 'guest-facing URL support missing: ' + text);
console.log('PASS guest links static: links open in new tab, protocols restricted, four guest-facing surfaces covered');
