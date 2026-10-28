// Token scope comes from the gateway. No browser total/completion flag is used.
export async function submitEntryCheckin({ callRPC, propertyId, bookingCode, isTest, record, submissionId, ordinal }) {
  try {
    const response = await callRPC('entry_access_submit_checkin', {
      p_property_id: propertyId, p_booking_code: bookingCode, p_is_test: isTest === true,
      p_submission_id: submissionId || null, p_ordinal: Number.isInteger(ordinal) ? ordinal : null,
      p_record: record,
    });
    const data = await response.json();
    if (!response.ok) {
      return { error: ['22023', '40001', '23505'].includes(data?.code)
        ? 'entry_submission_conflict' : 'entry_submission_unavailable',
      status: ['22023', '40001', '23505'].includes(data?.code) ? 409 : 503 };
    }
    if (data?.enabled === false) return { enabled: false };
    if (data?.enabled === true && typeof data.id === 'string' && data.booking_code === bookingCode) return data;
  } catch (_) { /* A failed/unknown opt-in read can never select the legacy write. */ }
  return { error: 'entry_submission_unavailable', status: 503 };
}
