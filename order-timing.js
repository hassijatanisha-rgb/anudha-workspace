'use strict';

// Each visit ends at the next actual transition, never at a guessed stage date.
function orderTiming(events,status,now=Date.now(),complete=true){
 const seen=new Set(),visits=[];let reliable=complete;
 const rows=events.filter(event=>{if(seen.has(event.id))return false;seen.add(event.id);return true;})
  .map(event=>({...event,time:Date.parse(event.created_at)})).sort((a,b)=>a.time-b.time);
 for(const event of rows){
  if(!Number.isFinite(event.time)||event.time>now){reliable=false;continue;}
  const previous=visits.at(-1);
  if(previous&&event.from_status===previous.status&&event.to_status===previous.status)continue;
  const connected=previous&&event.from_status===previous.status&&!['cancelled','delivered','rejected'].includes(previous.status);
  if(previous){previous.endedAt=event.created_at;previous.endedBy=event.actor_user_id||null;previous.durationMs=connected?event.time-previous.time:null;if(!connected)reliable=false;}
  else if(event.from_status)reliable=false;
  visits.push({status:event.to_status,startedAt:event.created_at,startedBy:event.actor_user_id||null,time:event.time,endedAt:null,endedBy:null,durationMs:null});
 }
 const last=visits.at(-1),terminal=['delivered','cancelled','rejected'].includes(status);
 const matches=last?.status===status;
 if(!matches)reliable=false;
 if(last&&matches)last.durationMs=terminal?0:now-last.time;
 return {visits,reliable,waitingMs:matches&&!terminal?now-last.time:null,totalMs:reliable&&visits.length?(terminal?last.time:now)-visits[0].time:null};
}
function orderDuration(milliseconds){
 if(milliseconds===null||!Number.isFinite(milliseconds))return 'Unknown';
 const minutes=Math.floor(milliseconds/60000),days=Math.floor(minutes/1440),hours=Math.floor(minutes%1440/60);
 return days?`${days}d ${hours}h ${minutes%60}m`:hours?`${hours}h ${minutes%60}m`:`${minutes}m`;
}
// A short final page proves completion. Errors and a safety ceiling never imply completeness.
async function fetchOrderEvents(backend,table,column,id){
 const rows=[];
 for(let offset=0;offset<20000;offset+=500){
  const result=await backend.from(table).select('*').eq(column,id).order('created_at').order('id').range(offset,offset+499);
  if(result.error)throw Error(result.error.message||'Event history could not load');
  rows.push(...(result.data||[]));
  if((result.data||[]).length<500)return rows;
 }
 throw Error('History is too large to confirm complete timing. Contact an administrator.');
}
