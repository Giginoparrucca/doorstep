// WhatsApp support contact in every email WelcomeBnB sends to hosts.
// The number comes from SUPPORT_WHATSAPP_E164; without it nothing is added.
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.SUPPORT_WHATSAPP_E164 = '+393509398782';
const W = await import('../api/_support-contact.js');
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

assert.equal(W.formatWhatsapp('+393509398782'), '+39 350 939 8782');
assert.equal(W.formatWhatsapp('+447700900123'), '+447700900123', 'non-Italian numbers shown as given');
assert.match(W.whatsappLink('+393509398782', 'it'), /^https:\/\/wa\.me\/393509398782\?text=Ciao%20WelcomeBnB/);
assert.match(W.whatsappLink('+393509398782', 'en'), /^https:\/\/wa\.me\/393509398782\?text=Hi%20WelcomeBnB/);

// Configured number is the default (env read at load).
const it = W.supportWhatsappHtml('it'), en = W.supportWhatsappHtml('en');
assert.match(it, /href="https:\/\/wa\.me\/393509398782\?text=/); assert.match(it, /Scrivici su WhatsApp/); assert.match(it, /\+39 350 939 8782/);
assert.match(en, /Chat on WhatsApp/); assert.match(en, /Need help\?/);
assert.match(W.supportWhatsappText('it'), /^Hai bisogno di aiuto\? WhatsApp: \+39 350 939 8782 — https:\/\/wa\.me\/393509398782/);
// No number (demo/local): nothing at all.
assert.equal(W.supportWhatsappHtml('it', null), ''); assert.equal(W.supportWhatsappText('en', ''), '');

// Every host email template uses the shared block.
const uses = {
  'api/send-arrival-reminders.js': [/\$\{supportWhatsappHtml\(lang\)\}\n      <p style="margin:20px 0 0;color:#6B7A90;font-size:12px;">\$\{T\.footer\}<\/p>/g, 2],  // arrivals digest + filing reminder
  'api/_notify-host.js': [/supportWhatsappHtml\(text\.lang === 'it' \? 'it' : 'en'\)|supportWhatsappText\(text\.lang === 'it' \? 'it' : 'en'\)/g, 2],  // chat/test/Alloggiati alerts: HTML + plain
  'api/_host-terms.js': [/supportWhatsappText\('it'\)/g, 4],  // terms code + receipt
  'api/admin-invite-host.js': [/supportWhatsapp(Html|Text)\('(it|en)'\)/g, 5],  // invite HTML IT/EN + plain
  'api/_onboarding-nudges.js': [/supportWhatsappHtml\(it \? 'it' : 'en', support\.whatsapp\)/g, 1],
};
for (const [file, [re, n]] of Object.entries(uses)) assert.ok((read(file).match(re) || []).length >= n, file);
// Every module that calls Resend is covered.
const senders = fs.readdirSync(new URL('../api/', import.meta.url)).filter(f => f.endsWith('.js') && read('api/' + f).includes('api.resend.com'));
for (const f of senders) assert.ok(/supportWhatsapp(Html|Text)/.test(read('api/' + f)), f + ' sends email without the WhatsApp contact');
// sendHostEmail in _notify-host takes caller-built HTML (onboarding nudges, covered above).

// The nudge email with the configured number shows the button and number.
const N = await import('../api/_onboarding-nudges.js');
const e = N.renderNudgeEmail({ kind: '24h', lang: 'it', propertyName: 'Villa', step: 'calendar', doneCount: 2, total: 5, consoleUrl: 'https://x/host-console.html', stopUrl: 'https://x/s', support: { whatsapp: '+393509398782', email: 'info@welcomebnb.it' } });
assert.match(e.html, /wa\.me\/393509398782/); assert.match(e.html, /\+39 350 939 8782/);

// The host console help widget reads the same configured number.
const { readEnvironment } = await import('../lib/environment.mjs');
assert.equal(readEnvironment({ SUPPORT_WHATSAPP_E164: '+39 350 939 8782' }).support.whatsapp, '+393509398782');
assert.equal(readEnvironment({}).support.whatsapp, '+393509398782', 'production default');
// Demo never gets the production number: scripts/environment.test.mjs (real demo fixture).

console.log('PASS support WhatsApp: +39 350 939 8782 with a wa.me chat button (IT/EN prefilled) in the arrivals digest, filing reminder, chat/test/Alloggiati alerts (HTML + plain), terms code and receipt, invite (IT/EN + plain) and onboarding nudges; nothing added without a configured number; console widget reads the same setting');
