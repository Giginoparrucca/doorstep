// Round 66: model context comes from the signed scope, never browser state.
import { loadEntryReleaseSnapshot } from './_entry-release-loader.js';
import { evaluateEntryRelease, projectEntryInstructions } from './_entry-release-policy.js';

const PUBLIC_FIELDS = [
  'id', 'name', 'address', 'city', 'zip', 'region', 'country', 'maps_link',
  'checkin_time', 'checkout_time', 'host_names', 'host_phone',
  'welcome_message', 'welcome_message_it', 'welcome_message_en',
];

export async function buildServerChatContext({ pgrestGET, callRPC, payload }) {
  const propertyId = payload.p;
  const response = await pgrestGET('properties?id=eq.' + encodeURIComponent(propertyId)
    + '&deleted_at=is.null&select=' + [...PUBLIC_FIELDS, 'wifi_name', 'wifi_password', 'entry_checkin_required'].join(',') + '&limit=1');
  if (!response?.ok) throw new Error('chat property unavailable');
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0].id !== propertyId) {
    throw new Error('chat property unavailable');
  }
  const row = rows[0];
  const property = Object.fromEntries(PUBLIC_FIELDS.filter(k => row[k] != null).map(k => [k, row[k]]));
  let snapshot = null;
  if (payload.b) snapshot = await loadEntryReleaseSnapshot({
    pgrestGET, callRPC, propertyId, bookingCode: payload.b, isTest: payload.t === true,
    sessionValidUntil: Number.isFinite(payload.exp) ? new Date(payload.exp * 1000).toISOString() : null,
  });
  // A failed snapshot never falls back to a browser's claim of completion.
  const policy = snapshot ? evaluateEntryRelease(snapshot) : { allow_entry: false, state: 'unavailable' };
  const entry = snapshot ? projectEntryInstructions(snapshot) : {};
  if (policy.allow_entry === true) {
    if (row.wifi_name != null) property.wifi_name = row.wifi_name;
    if (row.wifi_password != null) property.wifi_password = row.wifi_password;
  }
  const stay = {};
  if (snapshot?.booking) {
    for (const key of ['arrival_date', 'departure_date', 'expected_count']) {
      if (snapshot.booking[key] != null) stay[key] = snapshot.booking[key];
    }
  }
  // Recommendations and rules are public host content. Hosts must keep
  // entry secrets in dedicated access fields; no text scan can guarantee it.
  let rules = [];
  try {
    const r = await pgrestGET('rules?property_id=eq.' + encodeURIComponent(propertyId)
      + '&select=title_en,title_it,desc_en,desc_it,is_important&order=sort_order.asc');
    if (r?.ok) {
      const data = await r.json();
      if (Array.isArray(data)) rules = data;
    }
  } catch (_) { /* Optional public context; never a fallback to client data. */ }
  return {
    property, stay, policy, entry,
    // Also discard history if a concurrent read says the property opted in,
    // or a policy read fails. A previous assistant answer is not authority.
    freshTurnOnly: policy.allow_entry !== true || row.entry_checkin_required !== false
      || !snapshot || snapshot.property.entry_checkin_required === true,
    propertyContext: JSON.stringify({ property, house_rules: rules, permitted_entry: entry }),
    stayContext: JSON.stringify(stay),
  };
}

export function selectChatMessages(messages, freshTurnOnly) {
  // Never forward client tool/system blocks or arbitrary multimodal payloads.
  const valid = messages.filter(m => m && ['user', 'assistant'].includes(m.role)
    && typeof m.content === 'string' && m.content.trim());
  const last = valid.at(-1);
  if (!last || last.role !== 'user') return null;
  if (freshTurnOnly) return [{ role: 'user', content: last.content }];
  return valid.slice(-10).map(m => ({ role: m.role, content: m.content }));
}
