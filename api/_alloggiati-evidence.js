import { createHash, randomUUID } from 'node:crypto';
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const xmlEscape = value => String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const privateKeys = /^(token|password|wskey|utente|credentials_enc|credentials_nonce|issued|expires)$/i;
export function createFilingEvidence({ persist, propertyId, trigger, checkinIds, lines = [], rowIds, actor = null, secrets = [], version = process.env.VERCEL_GIT_COMMIT_SHA || 'unavailable', attemptId = randomUUID(), clock = () => new Date() }) {
  let currentLines = lines, currentIds = rowIds || checkinIds.map(id => [id]), sendStarted = false, sequence = 0;
  const hidden = new Set(secrets.filter(Boolean).map(String));
  function addSecrets(values) { for (const value of values.filter(Boolean)) hidden.add(String(value)); }
  function setRows(rows, ids) {
    currentLines = rows; currentIds = ids;
    addSecrets(rows.flatMap(line => [line, line.slice(14,64).trim(), line.slice(64,94).trim(), line.slice(95,105), line.slice(139,159).trim()]));
  }
  setRows(currentLines, currentIds);
  function redact(value) {
    let text = String(value ?? '').replace(/&#x([0-9a-f]+);|&#([0-9]+);|&(amp|lt|gt|quot|apos);/gi, (match,hex,decimal,named)=>{try{return hex||decimal?String.fromCodePoint(parseInt(hex || decimal,hex?16:10)):({amp:'&',lt:'<',gt:'>',quot:'\"',apos:"'"})[named.toLowerCase()];}catch{return match;}});
    for (const secret of [...hidden].sort((a,b)=>b.length-a.length)) {
      // Single-letter names are masked on word boundaries to preserve diagnostic words.
      for (const encoded of new Set([secret, xmlEscape(secret)])) {
        if (encoded.length === 1) text = text.replace(new RegExp('\\b'+encoded.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','g'),'[redacted]');
        else text = text.split(encoded).join('[redacted]');
      }
    }
    return text.replace(/<(?:\w+:)?(token|password|wskey|utente)\b[^>]*>[\s\S]*?<\/(?:\w+:)?\1\s*>/gi,'[redacted]')
      .replace(/\bBearer\s+[\w.\-]+/gi,'Bearer [redacted]')
      .replace(/\b(password|wskey|token|authorization|credentials_enc|credentials_nonce)\s*[:=]\s*[^\s,;|<>]+/gi,'$1=[redacted]');
  }
  function safe(value, key = '') {
    if (key === 'checkin_ids' && Array.isArray(value) && value.every(id=>/^[0-9a-f-]{36}$/i.test(id))) return value;
    if (typeof value === 'string') return redact(value);
    if (Array.isArray(value)) return value.map(item=>safe(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key])=>!privateKeys.test(key)).map(([key,item])=>[key,safe(item,key)]));
    return value;
  }
  async function record(stage, event, detail = {}) {
    const payload = { evidence_version: 1, attempt_id: attemptId, sequence: ++sequence, stage, event, captured_at: clock().toISOString(), code_version: version, parser_version: '64.6',
      request_sha256: hash(currentLines.join('\r\n')), rows: currentLines.map((line,i)=>({idx:i+1,checkin_ids:currentIds[i] || [],arrival_date:line.slice(2,12),sha256:hash(line)})), ...safe(detail) };
    try {
      await persist({ propertyId, trigger, checkinIds: [...new Set(currentIds.flat())], actor, outcome: 'evidence_' + (stage === 'send' ? 'send_' : '') + event, errorCode: detail.error_code || null, errorDetail: JSON.stringify(payload), strict: true });
    } catch {
      const error = Object.assign(new Error('Filing evidence could not be saved. No further portal operation is allowed; review any started Send before retrying.'), {code:'audit_unavailable',stage,sendUncertain:stage==='send' && sendStarted});
      throw error;
    }
  }
  async function response(stage, {status, body}) {
    // Keep every diagnostic leaf in wire order before parsing, plus response hash/shape.
    // Never keep arbitrary response text, token values or raw guest tracciato.
    const fields = [];
    const re=/<(?:[\w.-]+:)?(esito|ErroreCod|ErroreDes|ErroreDettaglio|SchedineValide|faultstring)\b[^>]*>([^<]*)<\/(?:[\w.-]+:)?\1\s*>/gi;
    for (const match of body.matchAll(re)) fields.push({field:match[1],value:match[2]});
    await record(stage,'response',{source:'portal_response',http_status:status,response_sha256:hash(body),diagnostic_fields:fields,
      response_elements:[...body.matchAll(/<\/?([\w.:-]+)(?=[\s/>])/g)].map(match=>match[1])});
  }
  async function failure(stage,error,source) {
    return record(stage,'failure',{source:source || (/timeout|network|http/.test(error.code || '')?'transport_uncertain':error.erroreCod || /bad_credentials|wskey_|user_disabled|portal_error/.test(error.code || '')?'portal_rejection':error.code==='unrecognized_response'?'unrecognized_response':'application_or_unclassified'),error_code:error.code || 'application_error',message:error.message || String(error),detail:error.erroreDet || '',send_result_uncertain:stage==='send' && sendStarted});
  }
  async function run(stage, operation) {
    await record(stage,'started',{source:'application'});
    if (stage === 'send') sendStarted = true;
    let result;
    try { result = await operation({onResponse:event=>response(stage,event)}); }
    catch(error) {
      if (error.code !== 'audit_unavailable') {
        try { await failure(stage,error); } catch(auditError) { auditError.originalCode=error.code; throw auditError; }
      }
      if(stage==='send')error.sendUncertain=true;
      throw error;
    }
    if (stage === 'credentials') addSecrets([result?.utente,result?.password,result?.wskey]);
    if (stage === 'authentication') addSecrets([result?.token]);
    if (stage === 'test' || stage === 'send') {
      const countMatches = result?.perRow?.length === currentLines.length;
      const rejected = result?.overall?.ok !== true || !countMatches || result.perRow.some(row=>row.ok !== true);
      await record(stage,rejected?'failure':'completed',{source:!countMatches?'unrecognized_response':rejected?'portal_rejection':'portal_response',error_code:!countMatches?'response_mismatch':rejected?'portal_rejected':null,overall:result.overall,
        response_count:result?.perRow?.length ?? null,per_row:(result.perRow || []).map((row,i)=>({idx:i+1,checkin_ids:currentIds[i] || [],...row})),send_result_uncertain:stage==='send' && rejected});
      if (!countMatches) throw Object.assign(new Error('Portal row count does not match the submitted batch; no further filing is allowed.'),{code:'response_mismatch',stage,sendUncertain:stage==='send'});
    } else await record(stage,'completed',{source:'application'});
    return result;
  }
  return { attemptId, run, record, failure, addSecrets, setRows, redact };
}
export function parseFilingEvidence(value) {
  try { const parsed = JSON.parse(value); return parsed?.evidence_version === 1 && typeof parsed.attempt_id === 'string' ? parsed : null; } catch { return null; }
}
