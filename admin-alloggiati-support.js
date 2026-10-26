// Property-scoped admin support dialog. Never exposes credentials or offers Send.
(function (root) {
  'use strict';
  const safe = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const when = value => value ? new Date(value).toLocaleString() : '—';
  const whenItaly = value => value ? new Date(value).toLocaleString('en-GB', {timeZone:'Europe/Rome'}) + ' (Italy)' : 'Not recorded';
  function guidance(code) {
    if (/past_portal_window/.test(code)) return 'Automatic filing window expired. Review the host’s late-filing route; do not blindly retry.';
    if (/test_rejected|validation_failed|SCHEDINA/.test(code)) return 'Guest data rejected. Validate the booking below to identify the row/field, then correct it in the host console.';
    if (/token|auth|cred|decrypt|not_configured/.test(code)) return 'Test the connection. If it fails, the host must update their Alloggiati credentials in Settings.';
    if (/transport|timeout/.test(code)) return 'Portal/network problem. Test the connection; for any Send-stage uncertainty check the portal/receipt before retrying.';
    if (/send_|correction|group_already_filed/.test(code)) return 'Check the portal/receipt and affected group before any retry: a filing may already exist.';
    if (/builder_warning/.test(code)) return 'Correct unresolved guest fields in the console, then validate the booking.';
    return 'Review the record and attempt history. Validation does not file guests or prove an earlier filing succeeded.';
  }
  let current = null;
  async function open({ propertyId, name, client, onConsole }) {
    if (current) current.close();
    const previousFocus = document.activeElement;
    const dialog = document.createElement('dialog'); dialog.className='alloggiati-support-dialog'; dialog.setAttribute('aria-labelledby','alloggiatiSupportTitle');
    dialog.style.cssText='width:min(1100px,calc(100vw - 24px));box-sizing:border-box;max-height:90vh;overflow:auto;border:1px solid #d7deea;border-radius:12px;padding:20px;color:#17233b;background:#fff;font:14px/1.5 system-ui,sans-serif;';
    dialog.innerHTML=`<style>.alloggiati-support-dialog button{font:inherit;padding:7px 10px;min-height:36px;border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;color:#17365f;cursor:pointer}.alloggiati-support-dialog button:disabled{opacity:.55;cursor:wait}.alloggiati-support-dialog h3{margin:18px 0 6px}.alloggiati-support-dialog p{margin:8px 0}.alloggiati-support-dialog td{vertical-align:top}.alloggiati-support-dialog [data-result]:not(:empty){padding:10px;background:#f8fafc;border-radius:8px;margin-top:12px}</style><div style="display:flex;justify-content:space-between;gap:12px;align-items:start;"><h2 id="alloggiatiSupportTitle" style="margin:0;">Alloggiati support · ${safe(name || propertyId)}</h2><button type="button" data-close aria-label="Close Alloggiati support">Close</button></div><p>Diagnostics for this property only. Test actions never file guests or change connection settings. Credential replacement remains with the host.</p><div data-body aria-live="polite">Loading connection and filing history…</div>`;
    document.body.append(dialog);
    let closed = false, busy = false;
    const close = () => { closed = true; dialog.remove(); if (current?.dialog===dialog) current=null; if (previousFocus?.isConnected) previousFocus.focus(); };
    current={dialog,close};dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.querySelector('[data-close]').addEventListener('click',close);dialog.showModal();
    const body=dialog.querySelector('[data-body]');
    async function call(action, extra = {}) {
      const {data,error}=await client.auth.getSession();const token=data?.session?.access_token;
      if(error || !token)throw Error('Admin session expired. Sign in again.');
      const response=await fetch('/api/alloggiati?action='+action,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({property_id:propertyId,...extra}),signal:AbortSignal.timeout(30000)});
      const result=await response.json();if(!response.ok)throw Error(result.error || 'Diagnostic request failed');return result;
    }
    function renderResult(result) {
      const target=dialog.querySelector('[data-result]');if(!target)return;
      if(result.stage==='original_attempts') {
        const first=result.history?.[0];
        target.innerHTML=`<h3>Original attempts · ${safe(result.booking_code || 'Selected booking')}</h3><p>${safe(result.message)}</p><p><strong>Earliest recorded attempt:</strong> ${first?safe(whenItaly(first.run_at)):'None found for these current guest record IDs. Older/deleted/replaced records are outside this search.'}</p><p>Guest submissions: ${(result.records||[]).map(row=>`${safe(row.id)} · ${safe(whenItaly(row.submitted_at))} · arrival ${safe(row.arrival_date)}`).join('<br>')}</p><h4>Current record checks</h4>${(result.findings||[]).map(finding=>`<p><strong>${safe(finding.code)}</strong>: ${safe(finding.message)}<br>Records: ${safe(finding.checkin_ids.join(', '))}</p>`).join('') || '<p>No duplicate identity or multiple-head warning found. This is not a complete portal validation.</p>'}<h4>Oldest ${result.history?.length || 0} matching attempts${result.history_truncated?' (limited to 50; later attempts omitted)':''}</h4>${(result.history||[]).map(log=>`<details style="border-top:1px solid #dde3ec;padding:8px 0;"><summary>${safe(whenItaly(log.run_at))} · ${safe(log.trigger)} · ${safe(log.outcome)}</summary><p>${safe(log.error_code)} · ${safe(log.error_detail || 'No additional detail recorded')}</p><p>Selected guest records in batch: ${safe((log.selected_checkin_ids||[]).join(', '))}. Other guest records in the same batch: ${safe(log.other_guest_count)}.</p><p>All guest record IDs in this batch: ${safe((log.checkin_ids||[]).join(', '))}</p><p>A Test rejection stops the whole automatic batch before Send; being included is not proof that this guest’s row was rejected.</p></details>`).join('') || '<p>No matching attempts recorded. Absence is not proof of filing or of no prior failures.</p>'}<p><strong>No portal test or filing was performed.</strong> Check-ins and connection settings were not changed. Where an old log contains only SCHEDINA_CAMPO_NON_CORRETTO, the original rejected field was not retained and cannot be recovered from that entry.</p>`;
        return;
      }
      const arrivalRejected=(result.rows||[]).some(row=>/data\s+di\s+arrivo\s+errata/i.test(row.detail || ''));
      const message=arrivalRejected ? 'The portal rejected the arrival date. Keep the true arrival date. A check run after the filing window expired does not establish the cause of an older failed attempt.' : result.error || result.message || '';
      target.innerHTML=`<h3>${result.ok ? '✓ Check passed' : 'Needs attention'}</h3><p>${safe(message)}</p>${result.error_code ? `<p><strong>${safe(result.error_code)}</strong> — ${safe(guidance(result.error_code))}</p>`:''}${result.checked_at ? `<p>Checked now: ${safe(when(result.checked_at))}</p>`:''}${result.past_automatic_window ? '<p style="color:#b03939;"><strong>Automatic filing window expired.</strong> Test success does not reopen it. Review the host’s late-filing route.</p>':''}${result.overall ? `<p>Service response (not filing status): ${safe(result.overall.error_code)} · ${safe(result.overall.message)} · ${safe(result.overall.detail)}</p>`:''}${(result.warnings||[]).map(w=>`<p>${safe(w)}</p>`).join('')}${(result.rows||[]).map(r=>`<div style="padding:8px;border-top:1px solid #dde3ec;"><strong>Row ${safe(r.idx)} · ${r.ok?'Valid':'Rejected / unknown'}</strong><br>Check-in: ${safe(r.checkin_id)}<br>${safe(r.error_code)} · ${safe(r.message)}<br><strong>${safe(r.detail)}</strong></div>`).join('')}<p><strong>No guests were filed.</strong> ${arrivalRejected ? 'Change the arrival date only if the saved date is factually wrong. For an expired window, ask the host’s issuing Alloggiati office for the late-filing procedure.' : 'Open the host console, enable editing explicitly, and correct rejected guest fields.'} After any Send-stage ambiguity, confirm existing portal/receipt state before filing.</p>`;
    }
    async function load() {
      body.textContent='Loading connection and filing history…';
      try {
        const data=await call('support_status');if(closed)return;
        const connection=data.connection;
        const groups=new Map();for(const row of data.records){const key=row.booking_code || row.id;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
        const bookings=[...groups.values()].sort((a,b)=>Number(b.some(r=>r.alloggiati_status!=='filed' && r.autofile_last_error))-Number(a.some(r=>r.alloggiati_status!=='filed' && r.autofile_last_error)));
        body.innerHTML=`<h3>Connection</h3><p><strong>${connection.configured?'Saved':'Not configured'}</strong> · Automatic filing: <strong>${safe(data.property.mode)}</strong><br>Last saved verification: ${safe(when(connection.verified_at))}<br>Web-service key expiry: ${connection.wskey_expires_at?safe(when(connection.wskey_expires_at)):'Not recorded (unknown)'}</p>${connection.last_error?`<p style="color:#b03939;">${safe(connection.last_error)}</p>`:''}<div style="display:flex;flex-wrap:wrap;gap:8px;"><button type="button" data-verify>Test saved connection</button><button type="button" data-refresh>Refresh diagnostics</button><button type="button" data-console>Open host console to fix records</button></div>
        <h3>Validate a booking without filing</h3><label style="display:block;">Booking<select data-booking aria-label="Booking to validate" style="display:block;padding:8px;max-width:100%;width:100%;">${bookings.map(rows=>`<option value="${safe(rows[0].id)}">${safe(rows[0].booking_code || 'No booking code · '+rows[0].id)} · ${safe(rows[0].arrival_date)} · ${rows.length} guest records${rows.some(r=>r.autofile_last_error && r.alloggiati_status!=='filed')?' · attention':''}</option>`).join('')}</select></label><button type="button" data-validate ${bookings.length?'':'disabled'} style="margin-top:8px;">Validate selected booking (no filing)</button><div data-result aria-live="polite"></div>
        <h3>Current guest records</h3><p>Latest ${data.records.length} non-test records${data.records_truncated?' (limited to 200; older records are not shown)':''}. Failed counts are affected guest records, not separate failed batches.</p><div style="overflow-x:auto;"><table style="width:100%;font-size:12px;text-align:left;"><thead><tr><th>Booking / check-in</th><th>Arrival / state</th><th>Last attempt</th><th>Reason and next action</th></tr></thead><tbody>${data.records.map(r=>`<tr><td style="padding:8px;">${safe(r.booking_code || 'No code')}<br>${safe(r.id)}</td><td style="padding:8px;">${safe(r.arrival_date)}<br>${safe(r.alloggiati_status || 'pending')}${r.autofile_excluded?'<br>Automatic filing excluded':''}</td><td style="padding:8px;">${safe(when(r.autofile_last_attempt_at))}<br>Transport retry counter: ${safe(r.autofile_attempts || 0)}</td><td style="padding:8px;">${safe(r.autofile_last_error || 'No recorded error')}${r.past_automatic_window && r.alloggiati_status!=='filed'?'<p style="color:#b03939;">Automatic filing window expired</p>':''}<br>${safe(r.alloggiati_status==='filed'?'Recorded filed. Do not resubmit merely to test.':guidance(r.autofile_last_error || ''))}</td></tr>`).join('') || '<tr><td colspan="4">No current check-ins.</td></tr>'}</tbody></table></div>
        <h3>Recent filing history</h3><p>Latest ${data.history.length} attempts${data.history_truncated?' (limited to 50)':''}. Older records may not include field detail. Manual portal-stage failures are recorded from this release; older failures may be absent. Absence of an error is not proof of success.</p>${data.history.map(log=>`<details style="border-top:1px solid #dde3ec;padding:8px 0;"><summary>${safe(when(log.run_at))} · ${safe(log.trigger)} · ${safe(log.outcome)} · ${(log.checkin_ids||[]).length} guest records</summary><p>${safe(log.error_code)} · ${safe(log.error_detail || 'No additional detail recorded')}</p><p>Check-ins: ${safe((log.checkin_ids||[]).join(', '))}</p></details>`).join('') || '<p>No filing attempts recorded.</p>'}`;
        body.querySelector('[data-refresh]').addEventListener('click',()=>{if(!busy)load();});
        body.querySelector('[data-console]').addEventListener('click',()=>{close();onConsole(propertyId);});
        const run=async(action,extra)=>{
          if(busy)return;busy=true;body.querySelectorAll('button').forEach(b=>b.disabled=true);body.querySelector('[data-result]').textContent='Checking… No filing will be performed.';
          try{const result=await call(action,extra);if(!closed)renderResult(result);}catch(error){if(!closed)body.querySelector('[data-result]').textContent=error.message+' Retry the check; no filing was performed.';}finally{busy=false;if(!closed){body.querySelectorAll('button').forEach(b=>b.disabled=false);body.querySelector('[data-validate]').disabled=!bookings.length;body.querySelector('[data-investigate]').disabled=!bookings.length;}}
        };
        const investigate=document.createElement('button');investigate.type='button';investigate.dataset.investigate='';investigate.textContent='Investigate original attempts (no portal test)';investigate.style.margin='8px';investigate.disabled=!bookings.length;
        body.querySelector('[data-validate]').after(investigate);
        investigate.addEventListener('click',()=>run('support_investigate',{checkin_id:body.querySelector('[data-booking]').value}));
        body.querySelector('[data-verify]').addEventListener('click',()=>run('support_verify'));
        body.querySelector('[data-validate]').addEventListener('click',()=>run('support_validate',{checkin_id:body.querySelector('[data-booking]').value}));
      }catch(error){if(closed)return;body.innerHTML=`<p>${safe(error.message)}</p><button type="button" data-retry>Retry diagnostics</button>`;body.querySelector('[data-retry]').addEventListener('click',load);}
    }
    await load();
  }
  root.AdminAlloggiatiSupport={open,guidance};
})(globalThis);
