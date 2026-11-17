// 17 Nov 2026 — admin home: one row per host account. Who registered and
// when, where their free trial stands (or when it ends), how active they are.
// Mounted on /api/admin-host-health (action users_overview); admin-only like
// every action there, read with the service role, journalled as
// host_health_read {view: users}.
//
// Row fields
//   email, user_id, properties [{id,name,test}], is_admin, is_test
//   invited_at, registered_at (password created: e-mail confirmed or first
//   sign-in), account_created_at, confirmed
//   status        invited | registered | active_account
//   plan          billing_access_state: prelaunch / trial (trial_ends_at,
//                 days_left) / grace / read_only / active (paid_until) / free
//   last_active_at  latest of console event and sign-in
//   active_days_7 / active_days_30  distinct Rome days with console activity
//   checkins_30   guest check-ins received in the last 30 days (real rows)
//   activity      active (used in the last 7 days) · slowing (8–30 days)
//                 · inactive (> 30 days) · never (never used the console)
const DAY = 86400000;
const romeDay = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));

export function activityLevel(lastActiveAt, now = Date.now()) {
  if (!lastActiveAt) return 'never';
  const age = now - new Date(lastActiveAt).getTime();
  if (age <= 7 * DAY) return 'active';
  if (age <= 30 * DAY) return 'slowing';
  return 'inactive';
}

export function buildRows({ users, invites, admins, properties, events, checkins, plans, now = Date.now() }) {
  const adminSet = new Set((admins || []).map(a => String(a.email || '').toLowerCase()));
  const propsBy = new Map();
  for (const p of properties || []) {
    if (!p.owner_id) continue;
    if (!propsBy.has(p.owner_id)) propsBy.set(p.owner_id, []);
    propsBy.get(p.owner_id).push(p);
  }
  const ownerOfProp = new Map((properties || []).map(p => [p.id, p.owner_id]));
  const daysBy = new Map(), lastEventBy = new Map();
  for (const e of events || []) {
    if (!e.user_id) continue;
    if (!daysBy.has(e.user_id)) daysBy.set(e.user_id, new Map());
    daysBy.get(e.user_id).set(romeDay(e.created_at), e.created_at);
    if (!lastEventBy.has(e.user_id) || e.created_at > lastEventBy.get(e.user_id)) lastEventBy.set(e.user_id, e.created_at);
  }
  const checkinsBy = new Map();
  for (const c of checkins || []) {
    const owner = ownerOfProp.get(c.property_id);
    if (owner) checkinsBy.set(owner, (checkinsBy.get(owner) || 0) + 1);
  }
  const inviteBy = new Map((invites || []).map(i => [String(i.email || '').toLowerCase(), i]));
  const rows = [];
  const seen = new Set();
  for (const u of users || []) {
    const email = String(u.email || '').toLowerCase();
    seen.add(email);
    const inv = inviteBy.get(email) || null;
    const props = (propsBy.get(u.id) || []).map(p => ({ id: p.id, name: p.name || '—', test: !!p.is_test }));
    const days = [...(daysBy.get(u.id) || new Map()).values()];
    const within = n => days.filter(d => now - new Date(d).getTime() <= n * DAY).length;
    const lastActive = [lastEventBy.get(u.id), u.last_sign_in_at].filter(Boolean).sort().at(-1) || null;
    rows.push({
      user_id: u.id, email: u.email || null, properties: props,
      is_admin: adminSet.has(email), is_test: props.length > 0 && props.every(p => p.test),
      // Invited accounts exist from the invitation on; «registered» is when
      // the host created a password (e-mail confirmed, or first sign-in).
      invited_at: inv ? inv.invited_at || null : u.invited_at || (!(u.email_confirmed_at || u.last_sign_in_at) ? u.created_at || null : null),
      registered_at: u.email_confirmed_at || u.last_sign_in_at || null, account_created_at: u.created_at || null,
      confirmed: !!(u.email_confirmed_at || u.last_sign_in_at),
      status: !(u.email_confirmed_at || u.last_sign_in_at) ? 'invited' : props.length ? 'active_account' : 'registered',
      plan: plans ? plans[u.id] || null : null,
      last_active_at: lastActive, active_days_7: within(7), active_days_30: within(30),
      checkins_30: checkinsBy.get(u.id) || 0,
      activity: !(u.email_confirmed_at || u.last_sign_in_at) ? 'never' : activityLevel(lastActive, now),
    });
  }
  // Invited addresses that never created an account.
  for (const inv of invites || []) {
    const email = String(inv.email || '').toLowerCase();
    if (!email || seen.has(email) || inv.status === 'revoked') continue;
    rows.push({ user_id: null, email: inv.email, properties: [], is_admin: adminSet.has(email), is_test: false,
      invited_at: inv.invited_at || null, registered_at: null, confirmed: false, status: 'invited', plan: null,
      last_active_at: null, active_days_7: 0, active_days_30: 0, checkins_30: 0, activity: 'never' });
  }
  // Newest registrations (or invitations) first.
  rows.sort((a, b) => String(b.registered_at || b.invited_at || '').localeCompare(String(a.registered_at || a.invited_at || '')));
  return rows;
}

export function summarize(rows, now = Date.now()) {
  const hosts = rows.filter(r => !r.is_admin && !r.is_test);
  const count = f => hosts.filter(f).length;
  const end = r => r.trial_ends_at || (r.plan && r.plan.state === 'trial' ? r.plan.trial_ends_at : null);
  const left = r => end(r) ? new Date(end(r)).getTime() - now : null;
  const soon = r => left(r) !== null && left(r) > 0 && left(r) <= 7 * DAY;
  return {
    hosts: hosts.length,
    registered_30: count(r => r.registered_at && now - new Date(r.registered_at).getTime() <= 30 * DAY),
    not_registered: count(r => r.status === 'invited'),
    active_7: count(r => r.activity === 'active'),
    inactive: count(r => r.activity === 'inactive' || (r.activity === 'never' && r.status !== 'invited')),
    trial_ending_7: count(soon),
    in_trial: count(r => left(r) !== null && left(r) > 0),
    trial_ended: count(r => left(r) !== null && left(r) <= 0),
    paying: count(r => r.plan && r.plan.state === 'active'),
    prelaunch: count(r => r.plan && r.plan.state === 'prelaunch'),
  };
}

// deps: { get(path), getAll(path), listUsers(), rpc(name, args), now() }
export async function buildUsersOverview(deps) {
  const now = deps.now ? deps.now() : Date.now();
  const since = new Date(now - 31 * DAY).toISOString();
  const [users, invites, admins, properties] = await Promise.all([
    deps.listUsers(),
    deps.getAll('pilot_invites?select=email,status,invited_at,accepted_at&order=invited_at.desc'),
    deps.get('admin_users?select=email'),
    deps.getAll('properties?deleted_at=is.null&select=id,name,owner_id,is_test&order=created_at.asc'),
  ]);
  const ids = users.map(u => u.id).filter(Boolean);
  const propIds = properties.filter(p => !p.is_test).map(p => p.id);
  const inList = list => `(${list.map(x => `"${x}"`).join(',')})`;
  const [events, checkins] = await Promise.all([
    ids.length ? deps.getAll(`analytics_events?user_id=in.${encodeURIComponent(inList(ids))}&created_at=gte.${since}&deleted_at=is.null&select=user_id,created_at&order=id.asc`) : [],
    propIds.length ? deps.getAll(`checkins?property_id=in.${encodeURIComponent(inList(propIds))}&is_test=is.false&deleted_at=is.null&submitted_at=gte.${since}&select=property_id&order=id.asc`) : [],
  ]);
  const plans = {};
  let planError = null, billingBy = null;
  if (deps.billing) {
    // Full billing per account (state, chip, subscription, last 5 events):
    // the same data the per-host «Abbonamento» box uses.
    try { billingBy = (await deps.billing(ids, new Date(now))).byOwner || {}; for (const id of ids) plans[id] = billingBy[id] ? billingBy[id].state : null; }
    catch (e) { planError = 'plan_unavailable'; }
  } else {
    await Promise.all(ids.map(async id => {
      try { plans[id] = await deps.rpc('billing_access_state', { p_user: id, p_now: new Date(now).toISOString() }); }
      catch (e) { planError = 'plan_unavailable'; }
    }));
  }
  const rows = buildRows({ users, invites, admins, properties, events, checkins, plans, now });
  if (billingBy) for (const r of rows) r.billing = r.user_id ? billingBy[r.user_id] || null : null;
  // Trial dates are stored from registration (17 Nov 2026), also before the
  // launch, when billing_access_state still answers «prelaunch».
  for (const r of rows) {
    const sub = r.billing && r.billing.subscription;
    r.trial_ends_at = (r.plan && r.plan.trial_ends_at) || (sub && sub.status === 'trialing' ? sub.trial_ends_at || null : null);
  }
  return { generated_at: new Date(now).toISOString(), summary: summarize(rows, now), rows, plan_error: planError };
}
