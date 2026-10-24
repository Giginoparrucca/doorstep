import { randomUUID } from 'node:crypto';
import { createReadClient, IresError } from './_ireservation-core.js';
import { createStore } from './_ireservation-store.js';
import { validateMapping, windowRange, compareReservations } from './_ireservation-compare.js';
import { SUPABASE_URL } from './_environment.js';
export async function comparisonAction({ action, body, row, identity, store, env, transport, comparisonStore }) {
  if (!row.secret || !row.verified_at) throw new IresError('connection_verification_required',400);
  const state=comparisonStore||createStore({url:SUPABASE_URL,serviceKey:env.SUPABASE_SERVICE_ROLE_KEY,transport,rpc:'ireservation_compare_state'});
  const scope={...identity,expected:row.version};
  const current=await state.call('mapping_get',scope);
  const client=createReadClient({store,env,transport});
  if(action==='catalog') {
    const rooms=await client.rooms(row),distributors=await client.distributors();
    if(new Set(rooms.map(r=>r.id)).size!==rooms.length)throw new IresError('provider_response_invalid');
    return {...current,provider_rooms:rooms,distributors,mode:'compare'};
  }
  if(body.mapping_version!==current.version)throw new IresError('connection_changed',409);
  if(action==='save_mapping') {
    const rooms=await client.rooms(row);
    const mappings=validateMapping(body.mappings,rooms,current.local_rooms);
    return state.call('mapping_save',{...scope,mapping_version:current.version,version:randomUUID(),mappings});
  }
  const range=windowRange(body.fromDate,body.toDate);
  const context=await state.call('comparison_context',{...scope,...range,mapping_version:current.version});
  const providerRooms=await client.rooms(row);
  const mappings=validateMapping(context.mappings,providerRooms,current.local_rooms);
  const native=await client.reservations(row,range),distributors=await client.distributors();
  const locals=context.local||[],truncated=locals.length>1000;
  const report=compareReservations({calendarId:row.calendar_id,native,local:locals.slice(0,1000),mapping:mappings,
    distributors,range,localTruncated:truncated});
  // Final CAS/ownership check rejects rotation, mapping edits and disconnect races.
  const saved=await state.call('comparison_save',{...scope,mapping_version:current.version,report});
  return {report:saved.report};
}
