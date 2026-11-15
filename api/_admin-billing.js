// Round 72 Phase 4 — admin billing actions, mounted on /api/admin-host-health
// (body.action = billing_*). The caller is checked as admin on the server
// first (verifyAdmin: caller JWT → /auth/v1/user → rpc/is_admin with the
// caller's JWT); every write uses the service role and writes exactly one
// billing_events row. Dates are Europe/Rome calendar days: the admin picks a
// day, the database stores the Rome midnight that starts the next one (the
// same rule as host_access_state).
//
//   billing_extend          +7/+14/+30 days or a chosen last free day; reason
//                           required; restores an expired host to 'trialing'.
//   billing_switch_to_paid  payment due from a chosen day (≥ today + 7, or
//                           earlier/today when the host asked, with a note);
//                           from trialing/expired or free_forever; emails the
//                           host once; re-applying the same date changes nothing.
//   billing_free_forever    on/off, reason required.
//   billing_mark_paid       bank transfer received: paid until (default one
//                           year), method bank_transfer, note.
//   billing_settings        price, IBAN, holder (not the launch switch).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const enc = encodeURIComponent;
const esc = s => String(s == null ? '' : s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));

export function romeYmd(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
}
export function addDays(ymd, n) { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
// UTC instant of 00:00 Europe/Rome on the given day (DST-aware).
export function romeMidnight(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  let t = Date.UTC(y, m - 1, d);
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(t)).map(x => [x.type, x.value]));
    const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    t -= local - Date.UTC(y, m - 1, d);
  }
  return new Date(t).toISOString();
}
// Last free (or paid) Rome day for an exclusive end instant.
export function lastDay(endIso) { return endIso ? romeYmd(new Date(new Date(endIso).getTime() - 1)) : null; }
export function fmtIt(ymd) { const [y, m, d] = ymd.split('-'); return `${d}/${m}/${y}`; }

// Admin chip text (Italian, as in the plan).
export function billingChip(state) {
  if (!state || !state.state) return null;
  switch (state.state) {
    case 'prelaunch': return 'Prima del lancio';
    case 'trial': return `Prova · ${state.days_left} gg`;
    case 'grace': return `Grazia · ${state.grace_days_left} gg`;
    case 'read_only': return 'Sola lettura';
    case 'active': return `Pagato fino al ${fmtIt(lastDay(state.paid_until))}`;
    case 'free': return state.reason === 'admin' ? 'Admin' : 'Gratis a vita';
    case 'none': return 'Nessun abbonamento';
    default: return null;
  }
}

export function renderSwitchToPaidEmail({ lang, dueYmd, priceEur = 60 }) {
  const en = lang === 'en';
  const [y, m, d] = dueYmd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString(en ? 'en-GB' : 'it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const price = Number(priceEur).toLocaleString(en ? 'en-GB' : 'it-IT', { maximumFractionDigits: 2 });
  const subject = en ? `WelcomeBnB becomes paid from ${date}` : `WelcomeBnB diventa a pagamento dal ${date}`;
  const text = en ? `From ${date} WelcomeBnB is paid (€${price}/year, VAT included). Nothing changes until then.`
    : `Dal ${date} l'uso di WelcomeBnB è a pagamento (${price} € l'anno, IVA inclusa). Fino ad allora non cambia nulla.`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#061A3D;font-size:15px;line-height:1.5;"><p>${esc(text)}</p><p>${en ? 'To subscribe, open the console → Settings → Subscription.' : 'Per abbonarti apri la console → Impostazioni → Abbonamento.'}</p></div>`;
  return { subject, html, text };
}

function bad(error, status = 400) { return { status, body: { error } }; }

// deps: get(path) → rows; patch(path, body) → rows; insert(table, row) → rows;
// event(row) → true; state(userId) → billing_access_state; userEmail(id); send(to, subject, html); lang(id)
export async function handleBillingAction(action, body, { actor, deps, now = new Date() }) {
  const today = romeYmd(now);
  if (action === 'billing_settings') {
    const patch = {};
    if (body.annual_price_cents != null) {
      const c = Number(body.annual_price_cents);
      if (!Number.isInteger(c) || c < 0 || c > 1000000) return bad('price_invalid');
      patch.annual_price_cents = c;
    }
    if (body.bank_transfer_iban !== undefined) {
      const iban = String(body.bank_transfer_iban || '').replace(/\s+/g, '').toUpperCase();
      if (iban && !/^[A-Z]{2}[0-9]{2}[0-9A-Z]{11,30}$/.test(iban)) return bad('iban_invalid');
      patch.bank_transfer_iban = iban || null;
    }
    if (body.bank_transfer_holder !== undefined) {
      const holder = String(body.bank_transfer_holder || '').trim();
      if (holder.length > 200) return bad('holder_invalid');
      patch.bank_transfer_holder = holder || null;
    }
    if (!Object.keys(patch).length) return bad('nothing_to_change');
    patch.updated_at = now.toISOString();
    const rows = await deps.patch('billing_settings?id=eq.1', patch);
    return { status: 200, body: { ok: true, settings: rows[0] || null } };
  }

  const userId = String(body.user_id || '');
  if (!UUID.test(userId)) return bad('user_id_invalid');
  const [sub] = await deps.get(`host_subscriptions?user_id=eq.${enc(userId)}&select=*&limit=1`);
  const reason = String(body.reason || body.note || '').trim();
  const write = async (fields, eventAction, oldValue, newValue, eventReason) => {
    const row = { ...fields, updated_at: now.toISOString() };
    const saved = sub ? (await deps.patch(`host_subscriptions?user_id=eq.${enc(userId)}`, row))[0]
      : (await deps.insert('host_subscriptions', { user_id: userId, trial_started_at: now.toISOString(), status: 'trialing', ...row }))[0];
    await deps.event({ user_id: userId, actor, action: eventAction, old_value: oldValue, new_value: newValue, reason: eventReason || null });
    return saved;
  };
  const old = sub ? { status: sub.status, trial_ends_at: sub.trial_ends_at, paid_until: sub.paid_until, free_forever_reason: sub.free_forever_reason } : null;

  if (action === 'billing_extend') {
    if (reason.length < 3) return bad('reason_required');
    if (sub && sub.status === 'free_forever') return bad('free_forever', 409);
    let newLast;
    if (body.until) {
      if (!YMD.test(body.until) || body.until < today) return bad('date_invalid');
      newLast = body.until;
    } else {
      const days = Number(body.days);
      if (![7, 14, 30].includes(days)) return bad('days_invalid');
      const cur = lastDay(sub && sub.trial_ends_at);
      const base = cur && cur >= addDays(today, -1) ? cur : addDays(today, -1);
      newLast = addDays(base, days);
    }
    const end = romeMidnight(addDays(newLast, 1));
    const saved = await write({ trial_ends_at: end, status: 'trialing', read_only_since: null }, 'trial_extended', old, { trial_ends_at: end, last_free_day: newLast }, reason);
    return { status: 200, body: { ok: true, subscription: saved, last_free_day: newLast } };
  }

  if (action === 'billing_switch_to_paid') {
    const due = String(body.due_date || '');
    if (!YMD.test(due)) return bad('date_invalid');
    const asked = body.host_asked === true;
    if (asked && reason.length < 3) return bad('note_required');
    if (due < (asked ? today : addDays(today, 7))) return bad(asked ? 'date_in_past' : 'notice_too_short');
    const status = sub ? sub.status : 'trialing';
    if (!['trialing', 'expired', 'past_due', 'free_forever'].includes(status)) return bad('not_switchable', 409);
    const end = romeMidnight(due);
    if (sub && status === 'trialing' && sub.trial_ends_at && new Date(sub.trial_ends_at).getTime() === new Date(end).getTime()) {
      return { status: 200, body: { ok: true, unchanged: true, subscription: sub } };
    }
    const eventAction = status === 'free_forever' ? 'free_forever_off'
      : (sub && sub.trial_ends_at && new Date(end) < new Date(sub.trial_ends_at)) ? 'trial_shortened' : 'trial_end_set';
    const saved = await write({ trial_ends_at: end, status: 'trialing', free_forever_reason: null, read_only_since: null }, eventAction, old,
      { trial_ends_at: end, payment_due_from: due, host_asked: asked }, reason || (asked ? null : 'switch to paid, 7+ days notice'));
    const [settings] = await deps.get('billing_settings?id=eq.1&select=annual_price_cents&limit=1');
    const to = await deps.userEmail(userId);
    let email = { ok: false, error: 'no_email' };
    if (to) {
      const lang = (await deps.lang(userId)) === 'en' ? 'en' : 'it';
      const msg = renderSwitchToPaidEmail({ lang, dueYmd: due, priceEur: (settings && settings.annual_price_cents != null ? settings.annual_price_cents : 6000) / 100 });
      email = await deps.send(to, msg.subject, msg.html);
    }
    return { status: 200, body: { ok: true, subscription: saved, email_sent: !!email.ok } };
  }

  if (action === 'billing_free_forever') {
    if (reason.length < 3) return bad('reason_required');
    if (body.on === true) {
      if (sub && sub.status === 'free_forever') return { status: 200, body: { ok: true, unchanged: true, subscription: sub } };
      const saved = await write({ status: 'free_forever', free_forever_reason: reason.slice(0, 500), read_only_since: null }, 'free_forever_on', old, { status: 'free_forever' }, reason);
      return { status: 200, body: { ok: true, subscription: saved } };
    }
    if (body.on === false) {
      if (!sub || sub.status !== 'free_forever') return { status: 200, body: { ok: true, unchanged: true, subscription: sub || null } };
      // Never ends without notice: at least 7 days from today (use «Passa a
      // pagamento» to choose a later date and email the host).
      const minEnd = romeMidnight(addDays(today, 7));
      const end = sub.trial_ends_at && new Date(sub.trial_ends_at) > new Date(minEnd) ? sub.trial_ends_at : minEnd;
      const saved = await write({ status: 'trialing', free_forever_reason: null, trial_ends_at: end }, 'free_forever_off', old, { status: 'trialing', trial_ends_at: end }, reason);
      return { status: 200, body: { ok: true, subscription: saved } };
    }
    return bad('on_required');
  }

  if (action === 'billing_mark_paid') {
    const paidOn = String(body.paid_on || today);
    if (!YMD.test(paidOn) || paidOn > today) return bad('date_invalid');
    const until = body.paid_until ? String(body.paid_until) : addDays(addYears(paidOn, 1), -1);
    if (!YMD.test(until) || until < paidOn) return bad('date_invalid');
    const end = romeMidnight(addDays(until, 1));
    const saved = await write({ status: 'active', paid_until: end, payment_method: 'bank_transfer', read_only_since: null, free_forever_reason: null },
      'marked_paid', old, { paid_on: paidOn, paid_until: end, last_paid_day: until, method: 'bank_transfer' }, reason || null);
    return { status: 200, body: { ok: true, subscription: saved, last_paid_day: until } };
  }
  return bad('unknown_action');
}
function addYears(ymd, n) { const [y, m, d] = ymd.split('-').map(Number); const t = new Date(Date.UTC(y + n, m - 1, d)); if (t.getUTCMonth() !== m - 1) t.setUTCDate(0); return t.toISOString().slice(0, 10); }
