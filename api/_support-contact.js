// WhatsApp support contact for every email WelcomeBnB sends to hosts.
// The number comes from SUPPORT_WHATSAPP_E164 (validated in
// lib/environment.mjs); when it is not set (demo, local) every helper
// returns an empty string, so a production number never leaks elsewhere.
// No lib/ imports: also used by functions whose bundle has no lib/**.
import { SUPPORT_CONTACTS } from './_environment.js';

const esc = s => String(s == null ? '' : s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));

// +393509398782 → "+39 350 939 8782" (Italian mobiles); other numbers as given.
export function formatWhatsapp(e164) {
  const m = /^\+39(3\d{2})(\d{3})(\d{3,4})$/.exec(e164 || '');
  return m ? `+39 ${m[1]} ${m[2]} ${m[3]}` : (e164 || '');
}

export function whatsappLink(e164, lang = 'it') {
  if (!e164) return '';
  const text = lang === 'en' ? 'Hi WelcomeBnB, I need help with' : 'Ciao WelcomeBnB, avrei bisogno di aiuto con';
  return `https://wa.me/${String(e164).replace(/^\+/, '')}?text=${encodeURIComponent(text)}`;
}

// HTML block with a button that opens a WhatsApp chat and the number in
// clear (for desktop readers). `number` defaults to the configured one.
export function supportWhatsappHtml(lang = 'it', number = SUPPORT_CONTACTS.whatsapp) {
  if (!number) return '';
  const en = lang === 'en';
  return `<div style="margin:24px 0 0;padding:16px;border:1px solid rgba(37,211,102,0.35);border-radius:10px;background:#F3FCF6;">
  <p style="margin:0 0 10px;font-size:14px;color:#061A3D;">${en ? 'Need help? Write to us on WhatsApp:' : 'Hai bisogno di aiuto? Scrivici su WhatsApp:'} <strong>${esc(formatWhatsapp(number))}</strong></p>
  <a href="${esc(whatsappLink(number, lang))}" style="display:inline-block;background:#25D366;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px;">💬 ${en ? 'Chat on WhatsApp' : 'Scrivici su WhatsApp'}</a>
</div>`;
}

// Plain-text line for text-only emails.
export function supportWhatsappText(lang = 'it', number = SUPPORT_CONTACTS.whatsapp) {
  if (!number) return '';
  return (lang === 'en' ? 'Need help? WhatsApp: ' : 'Hai bisogno di aiuto? WhatsApp: ') + formatWhatsapp(number) + ' — ' + whatsappLink(number, lang);
}
