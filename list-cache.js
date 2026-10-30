'use strict';
// A copy of the client, contact and product lists kept in this browser, so the next visit asks the server only for
// rows changed since (migration 089) instead of downloading all ~34,000 again. The server stays the source of truth:
// every load still fetches the changes, a copy older than 7 days is replaced in full, and the copy is wiped whenever
// the sign-in page is shown (sign-out, closed tab on a shared computer) or another person signs in.
const listCacheName='anudha-lists',listCacheSchema=1,listCacheMaxAge=7*86400000,listCacheOverlap=5*60000;
function listCacheOpen(){
 return new Promise((resolve,reject)=>{
  if(typeof indexedDB==='undefined')return reject(Error('No browser storage'));
  const request=indexedDB.open(listCacheName,1);
  request.onupgradeneeded=()=>request.result.createObjectStore('lists');
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
 });
}
async function listCacheRun(mode,fn){
 const db=await listCacheOpen();
 try{return await new Promise((resolve,reject)=>{const tx=db.transaction('lists',mode),store=tx.objectStore('lists');let result;const request=fn(store);if(request)request.onsuccess=()=>{result=request.result};tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(tx.error);});}
 finally{db.close();}
}
// Returns the saved lists for this person, or null (none, too old, another person, or the browser refused).
async function listCacheRead(userId,now=Date.now()){
 try{
  const saved=await Promise.race([listCacheRun('readonly',store=>store.get('lists')),new Promise(resolve=>setTimeout(()=>resolve(null),1500))]);
  if(!saved||saved.schema!==listCacheSchema||saved.userId!==userId||!(now-saved.savedAt<listCacheMaxAge))return null;
  if(!Array.isArray(saved.organizations)||!Array.isArray(saved.contacts)||!Array.isArray(saved.products)||!saved.since)return null;
  return saved;
 }catch{return null;}
}
async function listCacheWrite(record){try{await listCacheRun('readwrite',store=>store.put({...record,schema:listCacheSchema},'lists'));}catch{}}
async function listCacheClear(){try{await listCacheRun('readwrite',store=>store.clear());}catch{}}
// Latest change time in a set of rows, as an ISO string; '' when there are none.
// Kept exactly as the server wrote it (to the microsecond), so the next load can leave out rows carrying that very
// time: they are already in this copy. Rounding it to milliseconds made every load download again all the rows
// that share one time (migration 089 gave every existing client and contact the same time).
function listCacheLatest(rows,previous=''){
 let best=previous||'',bestTime=listCacheMicros(previous);
 for(const row of rows){const t=listCacheMicros(row.updated_at);if(t&&t>=bestTime){best=String(row.updated_at);bestTime=t;}}
 return bestTime?best:'';
}
// A time in microseconds since 1970 (the server keeps microseconds; Date.parse stops at milliseconds), 0 if unreadable.
function listCacheMicros(value){
 const ms=Date.parse(value);if(!Number.isFinite(ms))return 0;
 const extra=/\.\d{3}(\d{1,3})/.exec(String(value));
 return ms*1000+(extra?Number(extra[1].padEnd(3,'0')):0);
}
// Changed rows for a saved copy: from a little before the newest change seen, leaving out rows with exactly that time.
function listCacheChanged(query,since){
 const ranged=query.gte('updated_at',listCacheFrom(since));
 return since?ranged.neq('updated_at',since):ranged;
}
// Ask from a little before the last change seen, so a save that committed late is not missed.
function listCacheFrom(since){const t=Date.parse(since);return Number.isFinite(t)?new Date(t-listCacheOverlap).toISOString():'1970-01-01T00:00:00.000Z';}
// Apply changed rows: archived clients and contacts leave the list; products keep archived rows as before.
function listCacheMerge(rows,changes,keepArchived){
 if(!changes.length)return rows;
 const byId=new Map(rows.map(row=>[row.id,row]));
 for(const row of changes){if(row.deleted_at&&!keepArchived)byId.delete(row.id);else byId.set(row.id,row);}
 return [...byId.values()];
}
