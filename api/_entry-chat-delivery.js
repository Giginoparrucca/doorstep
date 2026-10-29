import { loadEntryReleaseSnapshot } from './_entry-release-loader.js';
import { evaluateEntryRelease } from './_entry-release-policy.js';

// The service-only RPC reads policy inputs and messages under one snapshot.
// Neither raw messages, provenance digests nor check-in records leave here.
export async function readEntryChat({ callRPC, propertyId, bookingCode, isTest, sessionExp, since = null, lang }) {
  const r = await callRPC('get_entry_chat_delivery', {
    p_property_id: propertyId, p_booking_code: bookingCode, p_is_test: isTest === true, p_since: since,
  });
  if (!r?.ok) throw new Error('Chat unavailable');
  const data = await r.json();
  if (!data || data.property_id !== propertyId || data.booking_code !== bookingCode
    || data.is_test !== (isTest === true) || typeof data.enabled !== 'boolean'
    || !Array.isArray(data.messages)) throw new Error('Chat unavailable');
  let snapshot = null, allow = false;
  if (data.enabled && data.snapshot && bookingCode) {
    const raw = data.snapshot;
    snapshot = await loadEntryReleaseSnapshot({
      propertyId, bookingCode, isTest, sessionValidUntil: Number.isFinite(sessionExp)
        ? new Date(sessionExp * 1000).toISOString() : null,
      pgrestGET: async path => ({ ok: true, json: async () => {
        if (path.startsWith('properties?')) return raw.property_snapshot ? [raw.property_snapshot] : [];
        if (path.startsWith('ota_reservations?')) return raw.reservation_snapshot ? [raw.reservation_snapshot] : [];
        if (path.startsWith('checkins?')) return raw.current_rows || [];
        if (path.startsWith('property_rooms?')) return raw.room_snapshot ? [raw.room_snapshot] : [];
        return [];
      } }),
      callRPC: async () => ({ ok: true, json: async () => raw }),
    });
    allow = snapshot && evaluateEntryRelease(snapshot).allow_entry === true;
  }
  let withheld = false;
  const messages = data.messages.map(row => {
    const visible = !data.enabled && row.entry_sensitive === false
      || data.enabled && allow && row.sender === 'host' && row.entry_sensitive === true
        && row.entry_identity_version === snapshot.booking.identity_version
        && typeof data.content_version === 'string' && data.content_version.length > 0
        && row.entry_content_version === data.content_version;
    const out = { id: row.id, sender: row.sender, booking_code: row.booking_code, created_at: row.created_at };
    if (visible) out.message = typeof row.message === 'string' ? row.message : '';
    else {
      withheld = true;
      out.entry_withheld = true;
      out.message = lang === 'it'
        ? 'Messaggio precedente non disponibile per sicurezza. Fai di nuovo la domanda o contatta il tuo host.'
        : 'Earlier message unavailable for security. Ask again or contact your host for help.';
    }
    return out;
  });
  return { messages, entry_chat_restricted: withheld };
}
